#pragma once
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#include <unistd.h>
#endif
inline std::vector<uint8_t> secure_bytes(size_t count){std::vector<uint8_t> data(count);
#ifdef _WIN32
 if(BCryptGenRandom(nullptr,data.data(),static_cast<ULONG>(data.size()),BCRYPT_USE_SYSTEM_PREFERRED_RNG)!=0)throw std::runtime_error("Secure random generation failed");
#else
 std::ifstream f("/dev/urandom",std::ios::binary);f.read(reinterpret_cast<char*>(data.data()),data.size());if(!f)throw std::runtime_error("Secure random generation failed");
#endif
 return data;}
inline int64_t available_kib(){
#ifdef _WIN32
 MEMORYSTATUSEX status{};status.dwLength=sizeof(status);return GlobalMemoryStatusEx(&status)?int64_t(status.ullAvailPhys/1024):0;
#else
 std::ifstream f("/proc/meminfo");std::string line;while(std::getline(f,line))if(line.rfind("MemAvailable:",0)==0){std::istringstream in(line.substr(13));int64_t value=0;in>>value;return value;}return 0;
#endif
}
inline double peak_rss_mib(){
#ifdef _WIN32
 PROCESS_MEMORY_COUNTERS counters{};return GetProcessMemoryInfo(GetCurrentProcess(),&counters,sizeof(counters))?double(counters.PeakWorkingSetSize)/(1024*1024):0;
#else
 rusage usage{};getrusage(RUSAGE_SELF,&usage);return usage.ru_maxrss/1024.;
#endif
}
inline void replace_file(const std::filesystem::path& from,const std::filesystem::path& to){
#ifdef _WIN32
 DWORD failure=ERROR_SUCCESS;
 for(unsigned attempt=0;attempt<100;++attempt){if(MoveFileExW(from.c_str(),to.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))return;failure=GetLastError();if(failure!=ERROR_ACCESS_DENIED&&failure!=ERROR_SHARING_VIOLATION&&failure!=ERROR_LOCK_VIOLATION)break;Sleep(10);}
 throw std::runtime_error("Cannot replace file: "+std::to_string(failure));
#else
 std::filesystem::rename(from,to);
#endif
}
inline void private_permissions(const std::filesystem::path& p,bool directory){
#ifndef _WIN32
 std::filesystem::permissions(p,directory?std::filesystem::perms::owner_all:(std::filesystem::perms::owner_read|std::filesystem::perms::owner_write),std::filesystem::perm_options::replace);
#endif
}
