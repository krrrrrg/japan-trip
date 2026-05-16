"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";

type TripDay = {
  id: string;
  date: string;
  title: string;
  createdAt: Timestamp;
};

type Place = {
  id: string;
  dayId: string;
  name: string;
  memo: string;
  category: string;
  done: boolean;
  order: number;
  createdAt: Timestamp;
};

const CATEGORIES = [
  { value: "food", label: "맛집", emoji: "🍜" },
  { value: "spot", label: "관광", emoji: "⛩️" },
  { value: "shopping", label: "쇼핑", emoji: "🛍️" },
  { value: "hotel", label: "숙소", emoji: "🏨" },
  { value: "transport", label: "이동", emoji: "🚅" },
  { value: "etc", label: "기타", emoji: "📌" },
];

function getCategoryEmoji(cat: string) {
  return CATEGORIES.find((c) => c.value === cat)?.emoji || "📌";
}

export default function Home() {
  const [days, setDays] = useState<TripDay[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [newCategory, setNewCategory] = useState("food");
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editCategory, setEditCategory] = useState("");

  // 실시간 동기화 - days
  useEffect(() => {
    const q = query(collection(db, "days"), orderBy("date", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TripDay));
      setDays(data);
      if (!selectedDay && data.length > 0) {
        setSelectedDay(data[0].id);
      }
    });
    return () => unsub();
  }, []);

  // 실시간 동기화 - places
  useEffect(() => {
    const q = query(collection(db, "places"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setPlaces(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Place)));
    });
    return () => unsub();
  }, []);

  const addDay = async () => {
    if (!newDate) return;
    await addDoc(collection(db, "days"), {
      date: newDate,
      title: newTitle || getDayLabel(newDate),
      createdAt: Timestamp.now(),
    });
    setNewDate("");
    setNewTitle("");
    setShowAddDay(false);
  };

  const deleteDay = async (dayId: string) => {
    if (!confirm("이 날짜와 모든 장소를 삭제할까요?")) return;
    // 해당 날짜의 장소들도 삭제
    const dayPlaces = places.filter((p) => p.dayId === dayId);
    for (const p of dayPlaces) {
      await deleteDoc(doc(db, "places", p.id));
    }
    await deleteDoc(doc(db, "days", dayId));
    if (selectedDay === dayId) {
      setSelectedDay(days.find((d) => d.id !== dayId)?.id || null);
    }
  };

  const addPlace = async () => {
    if (!newPlace || !selectedDay) return;
    const dayPlaces = places.filter((p) => p.dayId === selectedDay);
    await addDoc(collection(db, "places"), {
      dayId: selectedDay,
      name: newPlace,
      memo: newMemo,
      category: newCategory,
      done: false,
      order: dayPlaces.length,
      createdAt: Timestamp.now(),
    });
    setNewPlace("");
    setNewMemo("");
    setNewCategory("food");
    setShowAddPlace(false);
  };

  const toggleDone = async (place: Place) => {
    await updateDoc(doc(db, "places", place.id), { done: !place.done });
  };

  const deletePlace = async (placeId: string) => {
    await deleteDoc(doc(db, "places", placeId));
  };

  const startEdit = (place: Place) => {
    setEditingPlace(place.id);
    setEditName(place.name);
    setEditMemo(place.memo);
    setEditCategory(place.category);
  };

  const saveEdit = async (placeId: string) => {
    await updateDoc(doc(db, "places", placeId), {
      name: editName,
      memo: editMemo,
      category: editCategory,
    });
    setEditingPlace(null);
  };

  const getDayLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
  };

  const currentPlaces = places.filter((p) => p.dayId === selectedDay);
  const currentDay = days.find((d) => d.id === selectedDay);

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      {/* 헤더 */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold">🇯🇵 일본 여행</h1>
        <p className="text-sm text-gray-400 mt-1">둘이 함께 만드는 여행 계획</p>
      </div>

      {/* 날짜 탭 */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
        {days.map((day, idx) => (
          <button
            key={day.id}
            onClick={() => setSelectedDay(day.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              selectedDay === day.id
                ? "bg-red-500 text-white shadow-md"
                : "bg-white text-gray-600 border border-gray-200 hover:border-red-300"
            }`}
          >
            Day {idx + 1}
            <span className="ml-1 text-xs opacity-75">{getDayLabel(day.date)}</span>
          </button>
        ))}
        <button
          onClick={() => setShowAddDay(true)}
          className="flex-shrink-0 px-4 py-2 rounded-full text-sm border-2 border-dashed border-gray-300 text-gray-400 hover:border-red-300 hover:text-red-400 transition-all"
        >
          + 날짜
        </button>
      </div>

      {/* 날짜 추가 모달 */}
      {showAddDay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">날짜 추가</h3>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 mb-3 text-base"
            />
            <input
              type="text"
              placeholder="제목 (예: 도쿄 도착, 교토 이동)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 mb-4 text-base"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddDay(false)}
                className="flex-1 py-3 rounded-xl border text-gray-500"
              >
                취소
              </button>
              <button
                onClick={addDay}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-medium"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 선택된 날짜 헤더 */}
      {currentDay && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">{currentDay.title}</h2>
            <p className="text-sm text-gray-400">{currentDay.date}</p>
          </div>
          <button
            onClick={() => deleteDay(currentDay.id)}
            className="text-xs text-gray-300 hover:text-red-400 transition-colors"
          >
            삭제
          </button>
        </div>
      )}

      {/* 장소 리스트 */}
      {currentPlaces.length === 0 && selectedDay && (
        <div className="text-center py-12 text-gray-300">
          <p className="text-4xl mb-2">📍</p>
          <p>아직 장소가 없어요</p>
          <p className="text-sm">아래 + 버튼으로 추가해보세요!</p>
        </div>
      )}

      {!selectedDay && days.length === 0 && (
        <div className="text-center py-16 text-gray-300">
          <p className="text-5xl mb-4">✈️</p>
          <p className="text-lg">여행 날짜를 추가해주세요!</p>
          <p className="text-sm mt-1">위 &quot;+ 날짜&quot; 버튼을 눌러 시작</p>
        </div>
      )}

      <div className="space-y-3">
        {currentPlaces.map((place) => (
          <div
            key={place.id}
            className={`bg-white rounded-2xl p-4 shadow-sm border transition-all ${
              place.done ? "opacity-50 border-gray-100" : "border-gray-100"
            }`}
          >
            {editingPlace === place.id ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-base"
                />
                <input
                  type="text"
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  placeholder="메모"
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                />
                <div className="flex gap-1 flex-wrap">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setEditCategory(cat.value)}
                      className={`px-3 py-1 rounded-full text-xs ${
                        editCategory === cat.value
                          ? "bg-red-500 text-white"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {cat.emoji} {cat.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingPlace(null)}
                    className="flex-1 py-2 rounded-xl border text-gray-500 text-sm"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => saveEdit(place.id)}
                    className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm"
                  >
                    저장
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggleDone(place)}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                    place.done
                      ? "bg-red-500 border-red-500 text-white"
                      : "border-gray-300 hover:border-red-300"
                  }`}
                >
                  {place.done && <span className="text-xs">✓</span>}
                </button>
                <div className="flex-1 min-w-0" onClick={() => startEdit(place)}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{getCategoryEmoji(place.category)}</span>
                    <span
                      className={`font-medium ${place.done ? "line-through text-gray-400" : ""}`}
                    >
                      {place.name}
                    </span>
                  </div>
                  {place.memo && (
                    <p className="text-sm text-gray-400 mt-1 ml-7">{place.memo}</p>
                  )}
                </div>
                <button
                  onClick={() => deletePlace(place.id)}
                  className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 장소 추가 모달 */}
      {showAddPlace && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">장소 추가</h3>
            <input
              type="text"
              placeholder="장소 이름"
              value={newPlace}
              onChange={(e) => setNewPlace(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 mb-3 text-base"
              autoFocus
            />
            <input
              type="text"
              placeholder="메모 (선택)"
              value={newMemo}
              onChange={(e) => setNewMemo(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 mb-3 text-sm"
            />
            <div className="flex gap-1 flex-wrap mb-4">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setNewCategory(cat.value)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                    newCategory === cat.value
                      ? "bg-red-500 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAddPlace(false);
                  setNewPlace("");
                  setNewMemo("");
                }}
                className="flex-1 py-3 rounded-xl border text-gray-500"
              >
                취소
              </button>
              <button
                onClick={addPlace}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-medium"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 하단 추가 버튼 */}
      {selectedDay && (
        <button
          onClick={() => setShowAddPlace(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-red-600 transition-all hover:scale-105 active:scale-95"
        >
          +
        </button>
      )}
    </div>
  );
}
