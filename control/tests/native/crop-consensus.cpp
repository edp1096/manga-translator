#include "../../../native/ocr_crop_consensus.hpp"
#include <cassert>
int main(){
 assert(bounded_crop_correction("新しい学枚の場所を確認してください。","新しい学校の場所を確認してください。"));
 assert(bounded_crop_correction("Please confirm the nurnber on this card.","Please confirm the number on this card."));
 assert(!bounded_crop_correction("新しい学校の場所を確認してください。","新しい学校の場所を確認してください。"));
 assert(!bounded_crop_correction("新しい学校の場所を確認してください。","しい学校の場所を確認してください。"));
 assert(!bounded_crop_correction("Please confirm the district council.","Please confirm the council."));
 assert(!bounded_crop_correction("新しい学校の場所を確認してください。","古い工場の場所を確認してください。"));
 assert(!bounded_crop_correction("今こそ叫ぶアアアアアアアアーーッッ!!","今こそ叫ぶアアアアアアアーーッッ!!"));
 assert(!bounded_crop_correction("学校の場所","学枚の場所"));
 std::cout<<"PASS bounded internal multilingual OCR edits; clipped boundaries, dropped words, broad rewrites and repeated emphasis rejected\n";
}
