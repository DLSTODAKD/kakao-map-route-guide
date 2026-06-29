import test from "node:test";
import assert from "node:assert/strict";
import { classifyTransitPoint } from "./transitClassifier.js";

// 비교통 POI 는 이름에 "역"/"기차역"/"터미널"이 들어가도 제외되어야 한다.
test("CU 신촌기차역점(편의점) → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "CU 신촌기차역점",
      category_name: "가정,생활 > 편의점 > CU",
    }),
    null,
  );
});

test("스타벅스 강남역점(카페) → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "스타벅스 강남역점",
      category_name: "음식점 > 카페 > 커피전문점",
    }),
    null,
  );
});

test("신촌역 경의중앙선(지하철,전철) → subway_station", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "신촌역 경의중앙선",
      category_name: "교통,수송 > 지하철,전철 > 수도권경의중앙선",
    }),
    "subway_station",
  );
});

test("서울역(기차,철도) → rail_station", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "서울역",
      category_name: "교통,수송 > 기차,철도 > 기차역",
    }),
    "rail_station",
  );
});

test("서울고속버스터미널 → express_bus_terminal", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "서울고속버스터미널",
      category_name: "교통,수송 > 교통시설 > 고속버스터미널",
    }),
    "express_bus_terminal",
  );
});

test("강남역 지하상가(쇼핑) → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "강남역 지하상가",
      category_name: "쇼핑 > 상가",
    }),
    null,
  );
});

// 추가 경계 케이스
test("GS25 서울역점(편의점) → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "GS25 서울역점",
      category_name: "가정,생활 > 편의점 > GS25",
    }),
    null,
  );
});

test("신촌역 주차장 → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "신촌역 공영주차장",
      category_name: "교통,수송 > 주차장 > 공영주차장",
    }),
    null,
  );
});

test("동서울종합터미널(시외) → intercity_bus_terminal", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "동서울종합터미널",
      category_name: "교통,수송 > 교통시설 > 시외버스터미널",
    }),
    "intercity_bus_terminal",
  );
});

test("터미널식당(음식점) → null", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "터미널식당",
      category_name: "음식점 > 한식",
    }),
    null,
  );
});

// 공항철도는 category_name 에 "철도"가 들어가지만 지하철,전철 계열 →
// 기차(rail)가 아니라 지하철(subway)로 분류되어야 한다(지하철 우선 판정).
test("서울역 공항철도(지하철,전철) → subway_station", () => {
  assert.equal(
    classifyTransitPoint({
      place_name: "서울역 공항철도",
      category_name: "교통,수송 > 지하철,전철 > 공항철도",
    }),
    "subway_station",
  );
});
