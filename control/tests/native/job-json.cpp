#include "../../../native/job_json.hpp"
#include <atomic>
#include <thread>
#include <cassert>
int main(int argc,char**argv){assert(argc==2);auto folder=fs::u8path(argv[1]);fs::create_directories(folder);atomic_job_json(folder/"status.json",{{"status","ocr"},{"n",0}});std::atomic<bool> done{false};std::atomic<size_t> errors{0},reads{0};std::vector<std::thread> workers;
 for(int i=0;i<4;++i)workers.emplace_back([&](){while(!done){try{auto value=read_job_snapshot(folder);if(value.is_null()||!value.contains("n"))++errors;}catch(...){++errors;}++reads;std::this_thread::sleep_for(std::chrono::milliseconds(1));}});
 for(int i=1;i<=2000;i++)atomic_job_json(folder/"status.json",{{"status","ocr"},{"n",i}});done=true;for(auto&t:workers)t.join();assert(reads>0&&errors==0);
 atomic_job_json(folder/"result.json",{{"translation","complete"}});atomic_job_json(folder/"status.json",{{"status","done"}});assert(read_job_snapshot(folder).at("result").at("translation")=="complete");assert(read_job_snapshot(folder/"missing").is_null());
 {std::ofstream out(folder/"status.json");out<<"invalid";}bool corrupt=false;try{read_job_snapshot(folder);}catch(...){corrupt=true;}assert(corrupt);
 std::cout<<json({{"reads",reads.load()},{"failures",errors.load()},{"writes",2000},{"completedResult",true},{"missingIsNull",true},{"corruptionNotHidden",true}}).dump()<<std::endl;
}
