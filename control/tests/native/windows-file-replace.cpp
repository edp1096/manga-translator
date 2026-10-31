#include "../../../native/platform.hpp"
#include <cassert>
#include <iostream>
#include <thread>

int main(){
 const auto directory=std::filesystem::temp_directory_path()/("manga-replace-"+std::to_string(GetCurrentProcessId()));std::filesystem::create_directory(directory);
 const auto source=directory/"status.tmp",target=directory/"status.json";
 {std::ofstream output(target);output<<"old";}{std::ofstream output(source);output<<"new";}
 HANDLE reader=CreateFileW(target.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr);assert(reader!=INVALID_HANDLE_VALUE);
 std::thread release([&](){Sleep(150);CloseHandle(reader);});replace_file(source,target);release.join();std::string value;{std::ifstream input(target);input>>value;}assert(value=="new");
 {std::ofstream output(source);output<<"next";}reader=CreateFileW(target.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr);assert(reader!=INVALID_HANDLE_VALUE);
 bool rejected=false;try{replace_file(source,target);}catch(const std::runtime_error&){rejected=true;}CloseHandle(reader);assert(rejected);{std::ifstream input(target);input>>value;}assert(value=="new");assert(std::filesystem::exists(source));
 replace_file(source,target);{std::ifstream input(target);input>>value;}assert(value=="next");std::filesystem::remove_all(directory);
 std::cout<<"PASS temporary Windows reader lock retries, bounded permanent lock failure, existing status preserved and later recovery\n";
}
