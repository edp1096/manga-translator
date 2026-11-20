#pragma once
#include "image_ops.hpp"
#include "ort_engine.hpp"

struct SupernovaEngine : Engine {
 Ort::Env env;
 Ort::SessionOptions options;
 Ort::Session prefill, decode;
 std::vector<float> positions;
 int minPatches, multiple;
 double maxScale;

 SupernovaEngine(const fs::path& dir, int threads, OrtExecution execution)
  : Engine(dir / "tokenizer.json", 256), env(private_ort_env("supernova-bench")),
    options(ort_options(threads, execution)),
    prefill(env, (dir / "hayai_prefill.onnx").c_str(), options),
    decode(env, (dir / "hayai_decode.onnx").c_str(), options),
    positions(read_positions(dir / "pos_embedding.npy")) {
  const auto config = read_json(dir / "hayai_onnx_config.json");
  tokenizer.bos = config.at("bos_token_id");
  tokenizer.eos = config.at("eos_token_id");
  tokenizer.pad = config.at("pad_token_id");
  tokenizer.special = {tokenizer.bos, tokenizer.eos, tokenizer.pad};
  require(config.at("patch_size") == 16, "Unexpected patch size");
  minPatches = config.at("min_patches");
  maxScale = config.at("max_scale");
  multiple = config.at("pad_to_multiple_of");
 }

 std::string name() const override { return "onnx-v27-kv"; }

 Result run(const fs::path& image, int maxTokens) override {
  const auto start = Clock::now();
  require(maxTokens > 0 && maxTokens <= 4096, "Invalid OCR token budget");
  const auto crop = load_page(image);
  const int w = crop.width, h = crop.height;

  const auto axis = [](int n, double scale) { return std::max(1, static_cast<int>(std::ceil(n * scale / 16))); };
  const auto fit = [&](double lo, double hi, int limit) {
   while (hi - lo >= 1e-5) {
    const auto mid = (lo + hi) * 0.5;
    if (axis(w, mid) * axis(h, mid) <= limit) lo = mid;
    else hi = mid;
   }
   return lo;
  };
  auto scale = fit(1e-5, maxScale, budget);
  if (axis(w, scale) * axis(h, scale) < minPatches)
   scale = fit(scale, 100.0, std::min(minPatches, budget));
  const int ph = axis(h, scale), pw = axis(w, scale), n = ph * pw;
  const int slots = (n + multiple - 1) / multiple * multiple;
  const int visualSlots = ((ph + 1) / 2) * ((pw + 1) / 2);
  auto resized = resize_rgb(crop.rgb.data(), w, h, pw * 16, ph * 16);
  std::vector<float> pixels(size_t(slots) * 768, 0.0f);
  for (int y = 0; y < ph * 16; ++y) for (int x = 0; x < pw * 16; ++x) for (int c = 0; c < 3; ++c) {
   const auto patch = (y / 16) * pw + x / 16;
   const auto component = ((y % 16) * 16 + x % 16) * 3 + c;
   pixels[size_t(patch) * 768 + component] = resized[(size_t(y) * pw * 16 + x) * 3 + c] * (2.0f / 255.0f) - 1.0f;
  }
  auto pos = resize_positions(positions, pw, ph);
  pos.resize(size_t(slots) * 768, 0.0f);
  std::vector<int64_t> visualIndices(visualSlots);
  std::iota(visualIndices.begin(), visualIndices.end(), int64_t(0));
  int64_t dims[] = {ph, pw}, bos = tokenizer.bos;
  const char* preInputs[] = {"pixel_values", "pos_embeds", "spatial_shapes", "bos_ids", "l_vis_arange"};
  const char* preOutputs[] = {"logits", "k_cache", "v_cache", "vis_valid"};
  std::vector<Ort::Value> preValues;
  preValues.push_back(tensor(pixels, {1, slots, 768}));
  preValues.push_back(tensor(pos, {1, slots, 768}));
  preValues.push_back(tensor(dims, 2, {1, 2}));
  preValues.push_back(tensor(&bos, 1, {1, 1}));
  preValues.push_back(tensor(visualIndices, {visualSlots}));
  Result result;
  result.patches = n;
  result.ph = ph;
  result.pw = pw;
  result.prepare_ms = ms(start);
  const auto prefillStart = Clock::now();
  auto out = prefill.Run(Ort::RunOptions{nullptr}, preInputs, preValues.data(), preValues.size(), preOutputs, 4);
  result.prefill_ms = ms(prefillStart);
  const auto decodeStart = Clock::now();
  const auto valid = out[3].GetTensorData<int64_t>();
  std::vector<int64_t> attention(valid, valid + out[3].GetTensorTypeAndShapeInfo().GetElementCount());
  attention.push_back(1);
  for (int64_t step = 1; step <= maxTokens; ++step) {
   const auto logits = out[0].GetTensorData<float>();
   auto next = int64_t(std::max_element(logits, logits + out[0].GetTensorTypeAndShapeInfo().GetElementCount()) - logits);
   if (tokenizer.stop(next)) { result.stopped = true; break; }
   result.ids.push_back(next);
   if (step == maxTokens) break;
   const char* names[] = {"input_ids", "past_attention_mask", "position_id", "k_cache_in", "v_cache_in"};
   const char* outputs[] = {"logits", "k_cache_out", "v_cache_out"};
   std::vector<Ort::Value> in;
   in.push_back(tensor(&next, 1, {1, 1}));
   in.push_back(tensor(attention, {1, static_cast<int64_t>(attention.size())}));
   in.push_back(tensor(&step, 1, {1}));
   in.push_back(std::move(out[1]));
   in.push_back(std::move(out[2]));
   out = decode.Run(Ort::RunOptions{nullptr}, names, in.data(), in.size(), outputs, 3);
   attention.push_back(1);
  }
  result.decode_ms = ms(decodeStart);
  result.total_ms = ms(start);
  return result;
 }
};
