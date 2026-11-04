#include "../native/job_lock.hpp"
#include <iostream>
int main(int argc,char**argv){
 if(argc!=4)return 2;
 JobLease lease(std::filesystem::u8path(argv[1]),argv[2],std::string(argv[3])=="exclusive");
 if(!lease)return 3;
 std::cout<<"locked"<<std::endl;
 std::string line;std::getline(std::cin,line);
 return 0;
}
