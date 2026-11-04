#pragma once
#include <filesystem>
#include <stdexcept>
#ifdef _WIN32
#include <windows.h>
#else
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#endif
// Shared with the Go controller. Persistent lock files must never be unlinked.
class JobLease {
#ifdef _WIN32
 HANDLE handle=INVALID_HANDLE_VALUE;
 OVERLAPPED overlap{};
#else
 int handle=-1;
#endif
 bool held=false;
public:
 JobLease(const std::filesystem::path& jobs,const std::string& id,bool exclusive=false) {
  const auto directory=jobs.parent_path()/"job-locks";
  std::filesystem::create_directories(directory);
  const auto path=directory/(id+".lock");
  if(std::filesystem::is_symlink(directory)||std::filesystem::is_symlink(path))throw std::runtime_error("Invalid job lock path");
#ifdef _WIN32
  handle=CreateFileW(path.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
  if(handle!=INVALID_HANDLE_VALUE)held=LockFileEx(handle,LOCKFILE_FAIL_IMMEDIATELY|(exclusive?LOCKFILE_EXCLUSIVE_LOCK:0),0,1,0,&overlap)!=0;
#else
  handle=open(path.c_str(),O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
  if(handle>=0)held=flock(handle,(exclusive?LOCK_EX:LOCK_SH)|LOCK_NB)==0;
#endif
 }
 JobLease(const JobLease&)=delete;
 JobLease& operator=(const JobLease&)=delete;
 explicit operator bool() const {return held;}
 ~JobLease(){
#ifdef _WIN32
  if(handle!=INVALID_HANDLE_VALUE){if(held)UnlockFileEx(handle,0,1,0,&overlap);CloseHandle(handle);}
#else
  if(handle>=0){if(held)flock(handle,LOCK_UN);close(handle);}
#endif
 }
};
