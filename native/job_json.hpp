#pragma once
#include "common.hpp"
#include "platform.hpp"
#include <mutex>

// Windows readers can transiently fail to open a path during MoveFileExW.
// Serialize readers with the complete replacement, including existence checks.
inline std::mutex& job_json_mutex(){static std::mutex mutex;return mutex;}
inline void atomic_job_json(const fs::path& path,const json& value){
 std::lock_guard<std::mutex> lock(job_json_mutex());auto temporary=path;temporary+=".tmp";
 {std::ofstream out(temporary);out<<value.dump(-1,' ',false,json::error_handler_t::replace);out.flush();require(bool(out),"Cannot save job state");}
 replace_file(temporary,path);
}
inline json read_job_snapshot(const fs::path& folder){
 std::lock_guard<std::mutex> lock(job_json_mutex());
 if(!fs::is_directory(folder)||!fs::exists(folder/"status.json"))return nullptr;
 auto status=read_json(folder/"status.json");if(status.value("status",std::string{})=="done")status["result"]=read_json(folder/"result.json");return status;
}
