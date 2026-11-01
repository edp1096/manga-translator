#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define CPPHTTPLIB_THREAD_POOL_COUNT 4
#include "platform.hpp"
#include "pipeline.hpp"
#include "job_json.hpp"
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <atomic>
#include <regex>
#include <csignal>
static volatile std::sig_atomic_t stop_requested=0;
static void request_stop(int){stop_requested=1;}
#ifdef _WIN32
static BOOL WINAPI console_stop(DWORD){stop_requested=1;return TRUE;}
#endif
static bool valid_id(const std::string&s){static const std::regex pattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");return std::regex_match(s,pattern);}
static std::string random_hex(size_t bytes){auto data=secure_bytes(bytes);std::ostringstream out;out<<std::hex<<std::setfill('0');for(auto v:data)out<<std::setw(2)<<int(v);return out.str();}
static std::string job_id(){auto s=random_hex(16);s[12]='4';s[16]="89ab"[std::stoi(s.substr(16,1),nullptr,16)%4];return s.substr(0,8)+"-"+s.substr(8,4)+"-"+s.substr(12,4)+"-"+s.substr(16,4)+"-"+s.substr(20);}
static void atomic_json(const fs::path&p,const json&j){atomic_job_json(p,j);}
static bool token_equal(const std::string&a,const std::string&b){size_t diff=a.size()^b.size();for(size_t i=0;i<std::max(a.size(),b.size());++i)diff|=(i<a.size()?static_cast<unsigned char>(a[i]):0)^(i<b.size()?static_cast<unsigned char>(b[i]):0);return diff==0;}
int run(int argc,char**argv){try{
 require(argc==3&&std::string(argv[1])=="--root","Usage: manga-translator-server --root ABSOLUTE_DATA_DIRECTORY");fs::path root=fs::u8path(argv[2]);require(root.is_absolute(),"Data directory must be absolute");root=root.lexically_normal();
 auto config=read_json(root/"config/native_api.json");
#ifdef _WIN32
 require(config.contains("ort_library"),"Missing selected ONNX Runtime DLL path; update and start through the control app");
 fs::path ort_relative=fs::u8path(config.at("ort_library").get<std::string>());
 require(!ort_relative.empty()&&!ort_relative.is_absolute()&&!ort_relative.has_root_name(),"ONNX Runtime path must be relative to the app folder");
 for(const auto& part:ort_relative)require(part!="..","ONNX Runtime path leaves the app folder");
 manga_ort::library_path=root/ort_relative;
#endif
 manga_ort::initialize();

 if(config.value("ocr_backend",std::string("litert"))=="litert"){
  require(config.value("ocr_execution",std::string("cpu"))=="cpu","Hayai INT8 requires CPU; select the ONNX FP32 model for GPU OCR");
  require(config.contains("litert_library"),"Missing LiteRT runtime path; start this engine through the matching control app");
  fs::path relative=fs::u8path(config.at("litert_library").get<std::string>());
  require(!relative.empty()&&!relative.is_absolute()&&!relative.has_root_name(),"LiteRT path must be relative to the app folder");
  for(const auto&part:relative)require(part!="..","LiteRT path leaves the app folder");
  manga_litert::library_path=root/relative;
 }
require(config.at("host")=="127.0.0.1","Native API currently binds loopback only");int port=config.at("port");require(port>1024&&port<65536,"Invalid port");require(fs::is_regular_file(root/config.at("layout_model").get<std::string>()),"Layout model missing");require(fs::is_directory(root/config.at("ocr_dir").get<std::string>()),"OCR directory missing");fs::path data=root/config.at("data_dir").get<std::string>(),jobs=data/"jobs";fs::create_directories(jobs);private_permissions(data,true);auto tokenfile=data/"access-token";if(!fs::exists(tokenfile)){std::ofstream f(tokenfile);f<<random_hex(32)<<'\n';require(bool(f),"Cannot write API token");}private_permissions(tokenfile,false);std::string token="Bearer "+strip(read_text(tokenfile));require(token.size()>32,"API token is too short");
 std::mutex mutex,upload_mutex,inference_mutex;std::condition_variable cv;std::deque<std::pair<std::string,std::string>> queue;std::set<std::string> active;std::map<std::string,std::string> terminal_errors;std::atomic<bool> stopping{false};
 auto cleanup=[&](){std::unique_lock<std::mutex> maintenance(inference_mutex,std::try_to_lock);if(!maintenance.owns_lock())return;int days=1;const auto policy=data/"job-policy.json";if(fs::exists(policy)){try{const auto value=read_json(policy).at("retentionDays");if(!value.is_number_integer())return;days=value.get<int>();}catch(...){return;}}if(days<=0||days>365)return;auto now=fs::file_time_type::clock::now();for(const auto&entry:fs::directory_iterator(jobs)){if(entry.is_symlink()||!entry.is_directory()||!valid_id(entry.path().filename().string())||fs::exists(entry.path()/"keep.json"))continue;std::lock_guard<std::mutex> lock(mutex);if(!active.count(entry.path().filename().string())&&now-fs::last_write_time(entry.path())>std::chrono::hours(24*days)){std::lock_guard<std::mutex> files_lock(job_json_mutex());std::error_code ec;fs::remove_all(entry.path(),ec);}}};cleanup();
 for(auto&entry:fs::directory_iterator(jobs)){if(!entry.is_directory()||!valid_id(entry.path().filename().string())||!fs::exists(entry.path()/"status.json"))continue;auto s=read_json(entry.path()/"status.json");if(s.value("status","")!="done"&&s.value("status","")!="error")atomic_json(entry.path()/"status.json",{{"status","error"},{"error","Server restarted. Retry this page."}});}
 NativePipeline pipeline(root,config);std::atomic<size_t> manual_active{0};httplib::Server server;
 server.set_socket_options([](auto sock){int enabled=1;
#ifdef _WIN32
  setsockopt(sock,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,reinterpret_cast<const char*>(&enabled),sizeof(enabled));
#else
  setsockopt(sock,SOL_SOCKET,SO_REUSEADDR,&enabled,sizeof(enabled));
#endif
 });server.set_payload_max_length(25*1024*1024);server.set_read_timeout(30);server.set_write_timeout(30);server.set_keep_alive_max_count(20);
 auto reply=[](httplib::Response&r,const json&j,int status=200){r.status=status;r.set_content(j.dump(-1,' ',false,json::error_handler_t::replace),"application/json; charset=utf-8");r.set_header("Cache-Control","no-store");};
 server.set_pre_routing_handler([&](const httplib::Request&req,httplib::Response&res){auto origin=req.get_header_value("Origin");if(origin.rfind("chrome-extension://",0)==0){res.set_header("Access-Control-Allow-Origin",origin);res.set_header("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.set_header("Access-Control-Allow-Headers","Authorization,Content-Type");res.set_header("Access-Control-Allow-Private-Network","true");res.set_header("Vary","Origin");}if(req.method=="OPTIONS"){res.status=204;return httplib::Server::HandlerResponse::Handled;}if(req.path.rfind("/api/",0)==0&&!token_equal(req.get_header_value("Authorization"),token)){reply(res,{{"error","Invalid access token"}},401);return httplib::Server::HandlerResponse::Handled;}return httplib::Server::HandlerResponse::Unhandled;});
 server.set_exception_handler([&](const httplib::Request&,httplib::Response&res,std::exception_ptr ep){try{std::rethrow_exception(ep);}catch(const std::exception&e){reply(res,{{"error",std::string(e.what()).substr(0,1000)}},500);}catch(...){reply(res,{{"error","Internal error"}},500);}});
 server.Get("/health",[&](const httplib::Request&,httplib::Response&res){std::lock_guard<std::mutex> lock(mutex);reply(res,{{"ok",true},{"version","0.4.3-native"},{"native",true},{"restorationBackend",config.value("inpaint_backend",std::string("onnx"))},{"restorationReady",bool(pipeline.resident_restorer)},{"active",active.size()+manual_active.load()},{"maxRssMiB",peak_rss_mib()},{"models",{{"layout",config.at("layout_model")},{"ocr",config.at("ocr_dir")},{"ocrBackend",config.value("ocr_backend",std::string("litert"))},{"translation",config.at("llm_model")}}}});});
 server.Post("/api/jobs",[&](const httplib::Request&req,httplib::Response&res){if(stopping){reply(res,{{"error","Server stopping"}},503);return;}if(!req.has_file("image")){reply(res,{{"error","Missing image"}},400);return;}std::string target=req.has_file("target")?req.get_file_value("target").content:(req.has_param("target")?req.get_param_value("target"):"Korean");if(target!="Korean"&&target!="English"&&target!="Japanese"&&target!="Chinese"){reply(res,{{"error","Unsupported target language"}},400);return;}json dictionary=json::object();try{if(req.has_file("dictionary"))dictionary=checked_dictionary(json::parse(req.get_file_value("dictionary").content),target);}catch(const std::exception& error){reply(res,{{"error",error.what()}},400);return;}std::lock_guard<std::mutex> upload_lock(upload_mutex);{std::lock_guard<std::mutex> lock(mutex);if(active.size()>=8){reply(res,{{"error","Queue full; retry shortly"}},429);return;}}if(available_kib()<3*1024*1024){reply(res,{{"error","Insufficient available memory; retry when other workloads finish"}},503);return;}const auto& raw=req.get_file_value("image").content;if(raw.size()>24*1024*1024){reply(res,{{"error","Image exceeds 24 MiB"}},413);return;}PageImage im;try{im=decode_upload(raw);}catch(const std::exception&e){reply(res,{{"error",e.what()}},400);return;}auto id=job_id();auto folder=jobs/id;require(fs::create_directory(folder),"Cannot create job directory");write_png(folder/"original.png",im.width,im.height,3,im.rgb.data());json metadata={{"target",target},{"backend","native-local"},{"dictionary",dictionary}};for(const auto* key:{"title","pageURL","sourceURL","page"})if(req.has_file(key)){const auto value=req.get_file_value(key).content;if(value.size()<=8192){if(std::string(key)=="page"){try{const int page=std::stoi(value);if(page>0&&page<=100000)metadata[key]=page;}catch(...){}}else metadata[key]=value;}}atomic_json(folder/"request.json",metadata);atomic_json(folder/"status.json",{{"status","queued"}});{std::lock_guard<std::mutex> lock(mutex);active.insert(id);queue.emplace_back(id,target);}cv.notify_one();reply(res,{{"id",id}});});
 server.Get(R"(/api/jobs/([0-9a-f-]+))",[&](const httplib::Request&req,httplib::Response&res){std::string id=req.matches[1];if(!valid_id(id)){reply(res,{{"error","Not found"}},404);return;}{std::lock_guard<std::mutex> lock(mutex);const auto failure=terminal_errors.find(id);if(failure!=terminal_errors.end()){reply(res,{{"status","error"},{"error",failure->second}});return;}}auto s=read_job_snapshot(jobs/id);if(s.is_null()){reply(res,{{"error","Not found"}},404);return;}reply(res,s);});
 server.Get(R"(/api/jobs/([0-9a-f-]+)/([^/]+))",[&](const httplib::Request&req,httplib::Response&res){std::string id=req.matches[1],name=req.matches[2];if(!valid_id(id)||(name!="original.png"&&name!="cleaned.png"&&name!="mask.png"&&name!="result.json"&&name!="restored-v1.png"&&!std::regex_match(name,std::regex("manual-[0-9a-f]{32}\\.png")))||!fs::is_regular_file(jobs/id/name)){reply(res,{{"error","Not found"}},404);return;}res.set_file_content((jobs/id/name).string(),name=="result.json"?"application/json":"image/png");res.set_header("Cache-Control","no-store");});
 server.Post(R"(/api/jobs/([0-9a-f-]+)/restoration)",[&](const httplib::Request& request,httplib::Response& response){
  const std::string id=request.matches[1];if(!valid_id(id)||!fs::is_regular_file(jobs/id/"result.json")){reply(response,{{"error","Not found"}},404);return;}
  {std::lock_guard<std::mutex> lock(mutex);if(!active.empty()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}}
  std::unique_lock<std::mutex> lock(inference_mutex,std::try_to_lock);if(!lock.owns_lock()){reply(response,{{"error","Another engine task is running"}},409);return;}
  if(stopping||available_kib()<2*1024*1024){reply(response,{{"error","Engine is unavailable; retry later"}},503);return;}
  const auto restored=pipeline.restore_outside(jobs/id,[&](){require(!stopping&&!stop_requested&&!request.is_connection_closed(),"Restoration stopped; retry later");});release_heap();reply(response,restored);
 });
 server.Post(R"(/api/jobs/([0-9a-f-]+)/restoration/manual)",[&](const httplib::Request& request,httplib::Response& response){
  const std::string id=request.matches[1];if(!valid_id(id)||!fs::is_regular_file(jobs/id/"original.png")||!fs::is_regular_file(jobs/id/"result.json")){reply(response,{{"error","Not found"}},404);return;}
  json input;try{require(request.body.size()<=4*1024*1024,"Manual mask is too large");input=json::parse(request.body);const auto result=read_json(jobs/id/"result.json");checked_manual_mask(input,result.at("width"),result.at("height"));}catch(const std::exception& e){reply(response,{{"error",e.what()}},400);return;}
  {std::lock_guard<std::mutex> lock(mutex);if(!active.empty()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}}
  std::unique_lock<std::mutex> lock(inference_mutex,std::try_to_lock);if(!lock.owns_lock()){reply(response,{{"error","Another engine task is running"}},409);return;}
  if(stopping||available_kib()<2*1024*1024){reply(response,{{"error","Engine is unavailable; retry later"}},503);return;}
  struct BusyManual{std::atomic<size_t>& count;BusyManual(std::atomic<size_t>& c):count(c){++count;}~BusyManual(){--count;}} busy(manual_active);
  const auto restored=pipeline.restore_manual(jobs/id,input,"manual-"+random_hex(16)+".png",[&](){require(!stopping&&!stop_requested&&!request.is_connection_closed(),"Restoration stopped; retry later");});release_heap();reply(response,restored);
 });
 server.Post(R"(/api/jobs/([0-9a-f-]+)/bubbles)",[&](const httplib::Request& request,httplib::Response& response){
  const std::string identifier=request.matches[1];
  if(!valid_id(identifier)||!fs::is_regular_file(jobs/identifier/"original.png")){reply(response,{{"error","Not found"}},404);return;}
  {std::lock_guard<std::mutex> state_lock(mutex);if(!active.empty()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}}
  std::unique_lock<std::mutex> inference_lock(inference_mutex,std::try_to_lock);
  if(!inference_lock.owns_lock()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}
  if(stopping||available_kib()<3*1024*1024){reply(response,{{"error","Engine is unavailable; retry later"}},503);return;}
  const auto geometry=pipeline.bubbles(jobs/identifier);
  release_heap();reply(response,geometry);
 });
 server.Post(R"(/api/jobs/([0-9a-f-]+)/names/reading)",[&](const httplib::Request& request,httplib::Response& response){
  const std::string identifier=request.matches[1];if(!valid_id(identifier)||!fs::is_regular_file(jobs/identifier/"result.json")||!fs::is_regular_file(jobs/identifier/"original.png")){reply(response,{{"error","Not found"}},404);return;}
  json input;try{require(request.body.size()<1024,"Reading request is too large");input=json::parse(request.body);require(input.at("region").is_number_integer(),"Invalid region");require(!input.contains("preview")||input.at("preview").is_boolean(),"Invalid preview flag");}catch(const std::exception& error){reply(response,{{"error",error.what()}},400);return;}
  {std::lock_guard<std::mutex> state_lock(mutex);if(!active.empty()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}}
  std::unique_lock<std::mutex> inference_lock(inference_mutex,std::try_to_lock);if(!inference_lock.owns_lock()){reply(response,{{"error","Another engine task is running"}},409);return;}
  if(stopping||available_kib()<3*1024*1024){reply(response,{{"error","Engine is unavailable; retry later"}},503);return;}
  const auto result=pipeline.read_name(jobs/identifier,input.at("region"),input.value("preview",false));release_heap();reply(response,result);
 });
 server.Post(R"(/api/names/(correct|suggest))",[&](const httplib::Request& request,httplib::Response& response){
  if(request.body.size()>2*1024*1024){reply(response,{{"error","Name request is too large"}},413);return;}
  json input,dictionary;const std::string action=request.matches[1];
  try{input=json::parse(request.body);require(input.is_object(),"Invalid name request");if(action=="correct"){require(input.contains("result")&&input.at("result").is_object(),"Missing translation result");require(input.at("result").contains("regions")&&input.at("result").at("regions").is_array()&&input.at("result").at("regions").size()<=150,"Invalid regions");dictionary=checked_dictionary(input.at("dictionary"),input.at("result").value("target",std::string("Korean")));require(dictionary.contains("entries")&&!dictionary.at("entries").empty(),"Register character names first");}else{require(!name_string(input,"source").empty()&&!name_string(input,"translation").empty(),"Both names are required");}}
  catch(const std::exception& error){reply(response,{{"error",error.what()}},400);return;}
  {std::lock_guard<std::mutex> state_lock(mutex);if(!active.empty()){reply(response,{{"error","Translation is running; retry after it finishes"}},409);return;}}
  std::unique_lock<std::mutex> inference_lock(inference_mutex,std::try_to_lock);
  if(!inference_lock.owns_lock()){reply(response,{{"error","Another engine task is running; retry later"}},409);return;}
  if(stopping){reply(response,{{"error","Server stopping"}},503);return;}
  if(action=="correct")reply(response,pipeline.correct_names(input.at("result"),dictionary));
  else reply(response,pipeline.suggest_name(input.at("source"),input.at("translation")));
 });
 server.Get("/api/ping",[&](const httplib::Request&,httplib::Response&res){reply(res,{{"ok",true},{"version","0.4.3-native"}});});
 server.Post("/api/shutdown",[&](const httplib::Request&,httplib::Response&res){reply(res,{{"ok",true}});stop_requested=1;});
 std::signal(SIGINT,request_stop);std::signal(SIGTERM,request_stop);
#ifdef _WIN32
 SetConsoleCtrlHandler(console_stop,TRUE);
#endif
 std::thread worker([&](){for(;;){std::pair<std::string,std::string> next;{std::unique_lock<std::mutex> lock(mutex);cv.wait(lock,[&]{return stopping||!queue.empty();});if(stopping&&queue.empty())break;next=queue.front();queue.pop_front();}auto folder=jobs/next.first;try{require(!stopping,"Server stopping; retry this page");require(available_kib()>=3*1024*1024,"Insufficient available memory; retry later");auto progress=[&](std::string phase){require(!stopping,"Server stopping; retry this page");atomic_json(folder/"status.json",{{"status",phase}});std::cerr<<next.first<<' '<<phase<<std::endl;};json result;{std::lock_guard<std::mutex> inference_lock(inference_mutex);const auto dictionary=checked_dictionary(read_json(folder/"request.json").value("dictionary",json::object()),next.second);result=pipeline.process(folder,next.second,progress,dictionary);if(dictionary.contains("entries")&&result.value("nameWarnings",json::array()).empty())result["nameDictionary"]={{"id",dictionary.value("id",std::string{})},{"revision",dictionary.value("revision",std::string{})}};}result["maxRssMiB"]=peak_rss_mib();atomic_json(folder/"result.json",result);atomic_json(folder/"status.json",{{"status","done"}});std::cerr<<next.first<<" done "<<result["timings"]<<std::endl;}catch(const std::exception&e){const auto message=std::string(e.what()).substr(0,1500);{std::lock_guard<std::mutex> lock(mutex);if(terminal_errors.size()>=200)terminal_errors.erase(terminal_errors.begin());terminal_errors[next.first]=message;}try{atomic_json(folder/"status.json",{{"status","error"},{"error",message}});}catch(const std::exception& save_error){std::cerr<<next.first<<" status save failed "<<save_error.what()<<std::endl;}std::cerr<<next.first<<" error "<<message<<std::endl;}release_heap();{std::lock_guard<std::mutex> lock(mutex);active.erase(next.first);}cleanup();}});
 std::thread signal_thread([&](){while(!stopping&&!stop_requested)std::this_thread::sleep_for(std::chrono::milliseconds(100));if(stop_requested){stopping=true;cv.notify_all();server.stop();}});std::cout<<"Manga native API listening on 127.0.0.1:"<<port<<std::endl;bool ok=server.listen("127.0.0.1",port);stopping=true;cv.notify_all();worker.join();signal_thread.join();require(ok,"HTTP listen failed");return 0;
 }catch(const std::exception&e){std::cerr<<"ERROR "<<e.what()<<std::endl;return 1;}}

#ifdef _WIN32
int wmain(int argc,wchar_t**argv){std::vector<std::string> args;for(int i=0;i<argc;++i){int n=WideCharToMultiByte(CP_UTF8,0,argv[i],-1,nullptr,0,nullptr,nullptr);std::string s(n,'\0');WideCharToMultiByte(CP_UTF8,0,argv[i],-1,s.data(),n,nullptr,nullptr);s.resize(n-1);args.push_back(std::move(s));}std::vector<char*> pointers;for(auto& s:args)pointers.push_back(s.data());return run(argc,pointers.data());}
#else
int main(int argc,char**argv){return run(argc,argv);}
#endif
