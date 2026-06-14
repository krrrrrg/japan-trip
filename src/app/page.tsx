"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  link: string;
  category: string;
  done: boolean;
  order: number;
  time?: string;
  endTime?: string;
  createdAt: Timestamp;
};

type Photo = {
  id: string;
  placeId: string;
  dataUrl: string;
  order: number;
  createdAt: Timestamp;
};

type Booking = {
  id: string;
  type: string;
  title: string;
  order: number;
  [key: string]: unknown;
};

type Wish = {
  id: string;
  name: string;
  memo: string;
  link: string;
  category: string;
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

// 타임테이블 블록 색상 (카테고리별)
const CATEGORY_COLORS: Record<string, string> = {
  food: "bg-orange-100 border-orange-300 text-orange-800",
  spot: "bg-emerald-100 border-emerald-300 text-emerald-800",
  shopping: "bg-pink-100 border-pink-300 text-pink-800",
  hotel: "bg-indigo-100 border-indigo-300 text-indigo-800",
  transport: "bg-sky-100 border-sky-300 text-sky-800",
  etc: "bg-gray-100 border-gray-300 text-gray-700",
};

function getCategoryColor(cat: string) {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS.etc;
}

// "HH:MM" → 분 단위 숫자. 잘못된 값이면 null
function timeToMin(t?: string): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// PIN 검증
function verifyPin(input: string): boolean {
  return input === "7376";
}

// 구글맵 URL에서 장소명 자동 추출
function extractPlaceName(url: string): string | null {
  try {
    // /place/장소이름/ 패턴
    const match = url.match(/\/place\/([^/@]+)/);
    if (match) {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    }
    // /search/?...query=장소이름 패턴
    const searchMatch = url.match(/[?&]query=([^&]+)/);
    if (searchMatch) {
      return decodeURIComponent(searchMatch[1].replace(/\+/g, " "));
    }
    return null;
  } catch {
    return null;
  }
}

// 구글맵 URL인지 체크
function isGoogleMapsUrl(text: string): boolean {
  return (
    text.includes("google.com/maps") ||
    text.includes("maps.app.goo.gl") ||
    text.includes("share.google")
  );
}

// 이미지를 캔버스로 리사이즈/압축해서 data URL로 변환 (Firestore 저장용)
function compressImage(
  file: File,
  maxDim = 1280,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas context 없음"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [activeTab, setActiveTab] = useState<"schedule" | "wishes" | "bookings">("schedule");

  const [days, setDays] = useState<TripDay[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [showAddWish, setShowAddWish] = useState(false);
  const [wishInput, setWishInput] = useState("");
  const [wishParsedName, setWishParsedName] = useState("");
  const [wishParsedLink, setWishParsedLink] = useState("");
  const [wishLoading, setWishLoading] = useState(false);
  const [newWishCategory, setNewWishCategory] = useState("food");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [newCategory, setNewCategory] = useState("food");
  const [newLink, setNewLink] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editLink, setEditLink] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [scheduleView, setScheduleView] = useState<"list" | "timeline">("list");

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [photoTargetPlace, setPhotoTargetPlace] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ placeId: string; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 세션 체크
  useEffect(() => {
    if (typeof window !== "undefined") {
      const unlocked = sessionStorage.getItem("trip_unlocked");
      if (unlocked === "true") {
        setIsUnlocked(true);
      }
    }
  }, []);

  const handlePinSubmit = useCallback(() => {
    if (verifyPin(pinInput)) {
      setIsUnlocked(true);
      setPinError(false);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("trip_unlocked", "true");
      }
    } else {
      setPinError(true);
      setPinInput("");
    }
  }, [pinInput]);

  // PIN 입력 키패드
  const handlePinKey = useCallback(
    (key: string) => {
      if (key === "del") {
        setPinInput((prev) => prev.slice(0, -1));
        setPinError(false);
      } else if (key === "enter") {
        handlePinSubmit();
      } else if (pinInput.length < 4) {
        const next = pinInput + key;
        setPinInput(next);
        setPinError(false);
        // 4자리 입력 시 자동 확인
        if (next.length === 4) {
          setTimeout(() => {
            if (verifyPin(next)) {
              setIsUnlocked(true);
              if (typeof window !== "undefined") {
                sessionStorage.setItem("trip_unlocked", "true");
              }
            } else {
              setPinError(true);
              setPinInput("");
            }
          }, 200);
        }
      }
    },
    [pinInput, handlePinSubmit]
  );

  // 실시간 동기화 - days
  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "days"), orderBy("date", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TripDay));
      setDays(data);
      if (!selectedDay && data.length > 0) {
        setSelectedDay(data[0].id);
      }
    });
    return () => unsub();
  }, [isUnlocked]);

  // 실시간 동기화 - places
  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "places"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setPlaces(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Place)));
    });
    return () => unsub();
  }, [isUnlocked]);

  // 실시간 동기화 - bookings
  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "bookings"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking)));
    });
    return () => unsub();
  }, [isUnlocked]);

  // 실시간 동기화 - wishes
  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "wishes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setWishes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Wish)));
    });
    return () => unsub();
  }, [isUnlocked]);

  // 실시간 동기화 - photos
  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "photos"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setPhotos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Photo)));
    });
    return () => unsub();
  }, [isUnlocked]);

  // 링크 붙여넣기 시 서버에서 장소명 가져오기
  const handleWishInput = async (value: string) => {
    setWishInput(value);
    if (isGoogleMapsUrl(value)) {
      setWishParsedLink(value);
      setWishLoading(true);
      // 먼저 URL에서 빠르게 파싱 시도
      const quickName = extractPlaceName(value);
      if (quickName) setWishParsedName(quickName);
      // 서버 API로 정확한 한국어 이름 가져오기
      try {
        const res = await fetch("/api/place-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: value }),
        });
        const data = await res.json();
        if (data.name) {
          setWishParsedName(data.name);
        }
        if (data.finalUrl) {
          setWishParsedLink(data.finalUrl);
        }
      } catch {
        // API 실패해도 URL 파싱된 이름은 유지
      }
      setWishLoading(false);
    } else {
      setWishParsedName("");
      setWishParsedLink("");
    }
  };

  const addWish = async () => {
    const name = wishParsedName || wishInput;
    if (!name) return;
    await addDoc(collection(db, "wishes"), {
      name,
      memo: "",
      link: wishParsedLink || "",
      category: newWishCategory,
      createdAt: Timestamp.now(),
    });
    setWishInput("");
    setWishParsedName("");
    setWishParsedLink("");
    setNewWishCategory("food");
    setShowAddWish(false);
  };

  const deleteWish = async (wishId: string) => {
    await deleteDoc(doc(db, "wishes", wishId));
  };

  const moveWishToDay = async (wish: Wish, dayId: string) => {
    const dayPlaces = places.filter((p) => p.dayId === dayId);
    await addDoc(collection(db, "places"), {
      dayId,
      name: wish.name,
      memo: wish.memo,
      link: wish.link,
      category: wish.category,
      done: false,
      order: dayPlaces.length,
      createdAt: Timestamp.now(),
    });
    await deleteDoc(doc(db, "wishes", wish.id));
  };

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
    const dayPlaces = places.filter((p) => p.dayId === dayId);
    for (const p of dayPlaces) {
      const placePhotos = photos.filter((ph) => ph.placeId === p.id);
      for (const ph of placePhotos) {
        await deleteDoc(doc(db, "photos", ph.id));
      }
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
      link: newLink,
      category: newCategory,
      done: false,
      order: dayPlaces.length,
      time: newTime,
      endTime: newEndTime,
      createdAt: Timestamp.now(),
    });
    setNewPlace("");
    setNewMemo("");
    setNewLink("");
    setNewCategory("food");
    setNewTime("");
    setNewEndTime("");
    setShowAddPlace(false);
  };

  const toggleDone = async (place: Place) => {
    await updateDoc(doc(db, "places", place.id), { done: !place.done });
  };

  const deletePlace = async (placeId: string) => {
    const placePhotos = photos.filter((ph) => ph.placeId === placeId);
    for (const ph of placePhotos) {
      await deleteDoc(doc(db, "photos", ph.id));
    }
    await deleteDoc(doc(db, "places", placeId));
  };

  const startEdit = (place: Place) => {
    setEditingPlace(place.id);
    setEditName(place.name);
    setEditMemo(place.memo);
    setEditLink(place.link || "");
    setEditCategory(place.category);
    setEditTime(place.time || "");
    setEditEndTime(place.endTime || "");
  };

  const saveEdit = async (placeId: string) => {
    await updateDoc(doc(db, "places", placeId), {
      name: editName,
      memo: editMemo,
      link: editLink,
      category: editCategory,
      time: editTime,
      endTime: editEndTime,
    });
    setEditingPlace(null);
  };

  // 사진 추가 버튼 → 파일 선택창 열기
  const triggerPhotoUpload = (placeId: string) => {
    setPhotoTargetPlace(placeId);
    fileInputRef.current?.click();
  };

  // 선택한 사진들을 압축 후 Firestore에 저장
  const handlePhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const targetPlace = photoTargetPlace;
    if (!files || files.length === 0 || !targetPlace) {
      e.target.value = "";
      return;
    }
    setUploadingFor(targetPlace);
    let offset = photos.filter((p) => p.placeId === targetPlace).length;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await compressImage(file);
        await addDoc(collection(db, "photos"), {
          placeId: targetPlace,
          dataUrl,
          order: offset,
          createdAt: Timestamp.now(),
        });
        offset++;
      } catch {
        // 한 장 실패해도 나머지는 계속 진행
      }
    }
    setUploadingFor(null);
    setPhotoTargetPlace(null);
    e.target.value = "";
  };

  const deletePhoto = async (photoId: string) => {
    await deleteDoc(doc(db, "photos", photoId));
  };

  const getDayLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
  };

  const currentPlaces = places.filter((p) => p.dayId === selectedDay);
  const currentDay = days.find((d) => d.id === selectedDay);

  // 목록 정렬: 시간 있는 장소 먼저(시간순) → 시간 미정은 가나다순으로 맨 아래
  const sortedListPlaces = [...currentPlaces].sort((a, b) => {
    const ta = timeToMin(a.time);
    const tb = timeToMin(b.time);
    if (ta !== null && tb !== null) return ta - tb;
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return a.name.localeCompare(b.name, "ko");
  });

  // 라이트박스(전체화면 뷰어) 데이터 — photos가 실시간 갱신되어도 따라가도록 파생
  const lightboxPhotos = lightbox
    ? photos.filter((ph) => ph.placeId === lightbox.placeId)
    : [];
  const lightboxIndex = lightbox
    ? Math.min(lightbox.index, Math.max(lightboxPhotos.length - 1, 0))
    : 0;
  const lightboxPhoto = lightboxPhotos[lightboxIndex];

  // ========== PIN 잠금 화면 ==========
  if (!isUnlocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 select-none">
        <div className="text-center mb-8">
          <p className="text-5xl mb-4">🇯🇵</p>
          <h1 className="text-xl font-bold text-gray-700">일본 여행 플래너</h1>
          <p className="text-sm text-gray-400 mt-1">비밀번호를 입력하세요</p>
        </div>

        {/* PIN 표시 */}
        <div className="flex gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all ${
                i < pinInput.length
                  ? pinError
                    ? "bg-red-500 scale-110"
                    : "bg-gray-800 scale-110"
                  : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {pinError && (
          <p className="text-red-500 text-sm mb-4 animate-pulse">비밀번호가 틀렸어요</p>
        )}

        {/* 숫자 키패드 */}
        <div className="grid grid-cols-3 gap-3 w-64">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map(
            (key) =>
              key === "" ? (
                <div key="empty" />
              ) : (
                <button
                  key={key}
                  onClick={() => handlePinKey(key)}
                  className={`h-14 rounded-2xl text-xl font-medium transition-all active:scale-95 ${
                    key === "del"
                      ? "text-gray-400 text-base"
                      : "bg-white text-gray-800 shadow-sm border border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  {key === "del" ? "⌫" : key}
                </button>
              )
          )}
        </div>
      </div>
    );
  }

  // ========== 메인 앱 ==========
  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      {/* 헤더 */}
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold">🇯🇵 일본 여행</h1>
        <p className="text-sm text-gray-400 mt-1">둘이 함께 만드는 여행 계획</p>
      </div>

      {/* 메인 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
        <button
          onClick={() => setActiveTab("schedule")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === "schedule"
              ? "bg-white text-gray-800 shadow-sm"
              : "text-gray-400"
          }`}
        >
          📅 일정
        </button>
        <button
          onClick={() => setActiveTab("wishes")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === "wishes"
              ? "bg-white text-gray-800 shadow-sm"
              : "text-gray-400"
          }`}
        >
          💛 가고싶은 곳
        </button>
        <button
          onClick={() => setActiveTab("bookings")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === "bookings"
              ? "bg-white text-gray-800 shadow-sm"
              : "text-gray-400"
          }`}
        >
          🎫 예약
        </button>
      </div>

      {/* ===== 가고싶은 곳 탭 ===== */}
      {activeTab === "wishes" && (
        <>
          <div className="space-y-3">
            {wishes.map((w) => (
              <div
                key={w.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">
                    {getCategoryEmoji(w.category)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{w.name}</span>
                    {w.memo && (
                      <p className="text-sm text-gray-400 mt-0.5">{w.memo}</p>
                    )}
                    {w.link && (
                      <a
                        href={w.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-500 mt-1 hover:underline"
                      >
                        📍 지도 보기
                      </a>
                    )}
                    {/* 일정에 넣기 버튼 */}
                    {days.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2">
                        {days.map((day, idx) => (
                          <button
                            key={day.id}
                            onClick={() => moveWishToDay(w, day.id)}
                            className="px-2 py-1 rounded-lg text-xs bg-gray-100 text-gray-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            Day {idx + 1}에 넣기
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteWish(w.id)}
                    className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {wishes.length === 0 && (
              <div className="text-center py-12 text-gray-300">
                <p className="text-4xl mb-2">💛</p>
                <p>가고싶은 곳을 추가해보세요</p>
                <p className="text-sm">나중에 일정에 넣을 수 있어요!</p>
              </div>
            )}
          </div>

          {/* 위시 추가 모달 */}
          {showAddWish && (
            <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
              <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-sm shadow-xl">
                <h3 className="text-lg font-bold mb-2">가고싶은 곳 추가</h3>
                <p className="text-xs text-gray-400 mb-4">
                  구글맵 링크를 붙여넣으면 이름이 자동으로 나와요
                </p>
                <input
                  type="text"
                  placeholder="구글맵 링크 붙여넣기 or 장소 이름"
                  value={wishInput}
                  onChange={(e) => handleWishInput(e.target.value)}
                  className="w-full border rounded-xl px-4 py-3 mb-3 text-base"
                  autoFocus
                />
                {wishLoading && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3 text-center">
                    <p className="text-sm text-blue-500">장소 이름 가져오는 중...</p>
                  </div>
                )}
                {!wishLoading && wishParsedLink && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-3">
                    <p className="text-xs text-green-500 mb-1">장소 인식 완료!</p>
                    <input
                      type="text"
                      value={wishParsedName}
                      onChange={(e) => setWishParsedName(e.target.value)}
                      placeholder="이름 수정 가능"
                      className="w-full bg-white border border-green-200 rounded-lg px-3 py-2 text-base font-medium mt-1"
                    />
                  </div>
                )}
                <div className="flex gap-1 flex-wrap mb-4">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setNewWishCategory(cat.value)}
                      className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                        newWishCategory === cat.value
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
                      setShowAddWish(false);
                      setWishInput("");
                      setWishParsedName("");
                      setWishParsedLink("");
                    }}
                    className="flex-1 py-3 rounded-xl border text-gray-500"
                  >
                    취소
                  </button>
                  <button
                    onClick={addWish}
                    className="flex-1 py-3 rounded-xl bg-red-500 text-white font-medium"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 하단 추가 버튼 */}
          <button
            onClick={() => setShowAddWish(true)}
            className="fixed bottom-6 right-6 w-14 h-14 bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-red-600 transition-all hover:scale-105 active:scale-95"
          >
            +
          </button>
        </>
      )}

      {/* ===== 예약정보 탭 ===== */}
      {activeTab === "bookings" && (
        <div className="space-y-3">
          {bookings.map((b) => (
            <a
              key={b.id}
              href={b.url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 bg-white rounded-2xl p-5 shadow-sm border border-gray-100 active:scale-[0.98] transition-all"
            >
              <span className="text-3xl">{b.emoji as string}</span>
              <span className="font-bold text-lg flex-1">{b.label as string}</span>
              <span className="text-gray-300 text-xl">›</span>
            </a>
          ))}

          {bookings.length === 0 && (
            <div className="text-center py-12 text-gray-300">
              <p className="text-4xl mb-2">🎫</p>
              <p>아직 예약 정보가 없어요</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 일정 탭 ===== */}
      {activeTab === "schedule" && (
        <>
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
                <span className="ml-1 text-xs opacity-75">
                  {getDayLabel(day.date)}
                </span>
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

          {/* 목록 / 타임테이블 전환 */}
          {currentDay && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
              <button
                onClick={() => setScheduleView("list")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  scheduleView === "list"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-400"
                }`}
              >
                ☰ 목록
              </button>
              <button
                onClick={() => setScheduleView("timeline")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  scheduleView === "timeline"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-400"
                }`}
              >
                ⏱ 타임테이블
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
              <p className="text-sm mt-1">
                위 &quot;+ 날짜&quot; 버튼을 눌러 시작
              </p>
            </div>
          )}

          {scheduleView === "list" && (
          <div className="space-y-3">
            {sortedListPlaces.map((place) => (
              <div
                key={place.id}
                className={`bg-white rounded-2xl p-4 shadow-sm border transition-all ${
                  place.done
                    ? "opacity-50 border-gray-100"
                    : "border-gray-100"
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
                    <input
                      type="url"
                      value={editLink}
                      onChange={(e) => setEditLink(e.target.value)}
                      placeholder="구글맵 링크 (선택)"
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 ml-1">시작 시간</label>
                        <input
                          type="time"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          className="w-full border rounded-xl px-3 py-2 text-sm mt-0.5"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 ml-1">종료 (선택)</label>
                        <input
                          type="time"
                          value={editEndTime}
                          onChange={(e) => setEditEndTime(e.target.value)}
                          className="w-full border rounded-xl px-3 py-2 text-sm mt-0.5"
                        />
                      </div>
                    </div>
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
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => startEdit(place)}
                    >
                      <div className="flex items-center gap-2">
                        {place.time && (
                          <span className="text-xs font-semibold text-red-500 bg-red-50 rounded-md px-1.5 py-0.5 flex-shrink-0">
                            {place.time}
                            {place.endTime ? `~${place.endTime}` : ""}
                          </span>
                        )}
                        <span className="text-base">
                          {getCategoryEmoji(place.category)}
                        </span>
                        <span
                          className={`font-medium ${
                            place.done ? "line-through text-gray-400" : ""
                          }`}
                        >
                          {place.name}
                        </span>
                      </div>
                      {place.memo && (
                        <p className="text-sm text-gray-400 mt-1 ml-7">
                          {place.memo}
                        </p>
                      )}
                      {place.link && (
                        <a
                          href={place.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-blue-500 mt-1 ml-7 hover:underline"
                        >
                          📍 지도 보기
                        </a>
                      )}

                      {/* 사진 썸네일 + 추가 버튼 */}
                      <div className="ml-7 mt-2 flex gap-2 flex-wrap">
                        {photos
                          .filter((ph) => ph.placeId === place.id)
                          .map((ph, idx) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={ph.id}
                              src={ph.dataUrl}
                              alt=""
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightbox({ placeId: place.id, index: idx });
                              }}
                              className="w-16 h-16 object-cover rounded-lg cursor-pointer border border-gray-100 active:scale-95 transition-all"
                            />
                          ))}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerPhotoUpload(place.id);
                          }}
                          disabled={uploadingFor === place.id}
                          className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 text-gray-300 flex items-center justify-center text-xl hover:border-red-300 hover:text-red-400 transition-all disabled:opacity-50"
                        >
                          {uploadingFor === place.id ? (
                            <span className="text-xs animate-pulse">업로드중</span>
                          ) : (
                            "📷"
                          )}
                        </button>
                      </div>
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
          )}

          {/* ===== 타임테이블(간트) 뷰 ===== */}
          {scheduleView === "timeline" &&
            selectedDay &&
            currentPlaces.length > 0 &&
            (() => {
              const timed = currentPlaces
                .map((p) => ({ p, start: timeToMin(p.time) }))
                .filter((x): x is { p: Place; start: number } => x.start !== null)
                .sort((a, b) => a.start - b.start);
              const untimed = currentPlaces.filter(
                (p) => timeToMin(p.time) === null
              );

              if (timed.length === 0) {
                return (
                  <div className="text-center py-10 px-4 text-gray-400 bg-gray-50 rounded-2xl">
                    <p className="text-3xl mb-2">⏱</p>
                    <p className="text-sm">
                      아직 시간을 입력한 장소가 없어요.
                    </p>
                    <p className="text-xs mt-1 text-gray-300">
                      장소를 눌러 시작 시간을 넣으면 여기에 타임테이블로 표시돼요.
                    </p>
                  </div>
                );
              }

              // 각 일정의 종료 시각 계산 (명시 종료 → 다음 일정 시작 → +90분)
              const segs = timed.map((x, i) => {
                let end = timeToMin(x.p.endTime);
                if (end === null || end <= x.start) {
                  end =
                    i < timed.length - 1
                      ? timed[i + 1].start
                      : x.start + 90;
                }
                return { p: x.p, start: x.start, end };
              });

              const minStart = Math.floor(segs[0].start / 60) * 60;
              const maxEnd =
                Math.ceil(Math.max(...segs.map((s) => s.end)) / 60) * 60;
              const ppm = 1.3; // 분당 픽셀
              const totalH = (maxEnd - minStart) * ppm;
              const hours: number[] = [];
              for (let h = minStart; h <= maxEnd; h += 60) hours.push(h);
              const fmtHour = (h: number) =>
                `${String(Math.floor(h / 60)).padStart(2, "0")}:00`;

              return (
                <>
                  <p className="text-xs text-gray-300 mb-2">
                    블록을 누르면 수정할 수 있어요
                  </p>
                  <div className="relative" style={{ height: totalH }}>
                    {/* 시간 눈금 */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0 flex items-start"
                        style={{ top: (h - minStart) * ppm }}
                      >
                        <span className="text-[11px] text-gray-400 w-12 flex-shrink-0 -mt-2">
                          {fmtHour(h)}
                        </span>
                        <div className="flex-1 border-t border-gray-100" />
                      </div>
                    ))}
                    {/* 일정 블록 */}
                    {segs.map((seg) => {
                      const top = (seg.start - minStart) * ppm;
                      const height = Math.max((seg.end - seg.start) * ppm, 36);
                      return (
                        <div
                          key={seg.p.id}
                          onClick={() => {
                            startEdit(seg.p);
                            setScheduleView("list");
                          }}
                          className={`absolute rounded-lg border px-2 py-1 overflow-hidden cursor-pointer active:scale-[0.98] transition-all ${getCategoryColor(
                            seg.p.category
                          )} ${seg.p.done ? "opacity-50" : ""}`}
                          style={{
                            top,
                            height: height - 4,
                            left: 56,
                            right: 4,
                          }}
                        >
                          <div className="flex items-center gap-1 text-xs font-semibold">
                            <span>{getCategoryEmoji(seg.p.category)}</span>
                            <span
                              className={`truncate ${
                                seg.p.done ? "line-through" : ""
                              }`}
                            >
                              {seg.p.name}
                            </span>
                          </div>
                          <span className="text-[10px] opacity-70">
                            {seg.p.time}
                            {seg.p.endTime ? `~${seg.p.endTime}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 시간 미정 장소 */}
                  {untimed.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">⏰ 시간 미정</p>
                      <div className="flex flex-wrap gap-2">
                        {untimed.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              startEdit(p);
                              setScheduleView("list");
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs border ${getCategoryColor(
                              p.category
                            )}`}
                          >
                            {getCategoryEmoji(p.category)} {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

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
                <input
                  type="url"
                  placeholder="구글맵 링크 (선택)"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  className="w-full border rounded-xl px-4 py-3 mb-3 text-sm"
                />
                <div className="flex gap-2 mb-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 ml-1">시작 시간</label>
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm mt-0.5"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 ml-1">종료 (선택)</label>
                    <input
                      type="time"
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm mt-0.5"
                    />
                  </div>
                </div>
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
                      setNewLink("");
                      setNewTime("");
                      setNewEndTime("");
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
        </>
      )}

      {/* 사진 업로드용 숨겨진 파일 입력 (장소별 공용) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotoFiles}
        className="hidden"
      />

      {/* 전체화면 사진 뷰어 */}
      {lightbox && lightboxPhoto && (
        <div
          className="fixed inset-0 bg-black/95 z-[60] flex flex-col items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          {/* 닫기 */}
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white text-xl flex items-center justify-center active:scale-95"
          >
            ✕
          </button>

          {/* 사진 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxPhoto.dataUrl}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[78vh] max-w-[92vw] object-contain rounded-lg"
          />

          {/* 카운터 */}
          {lightboxPhotos.length > 1 && (
            <p className="text-white/70 text-sm mt-4">
              {lightboxIndex + 1} / {lightboxPhotos.length}
            </p>
          )}

          {/* 이전/다음 */}
          {lightboxPhotos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox({
                    placeId: lightbox.placeId,
                    index:
                      (lightboxIndex - 1 + lightboxPhotos.length) %
                      lightboxPhotos.length,
                  });
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 text-white text-2xl flex items-center justify-center active:scale-95"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox({
                    placeId: lightbox.placeId,
                    index: (lightboxIndex + 1) % lightboxPhotos.length,
                  });
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 text-white text-2xl flex items-center justify-center active:scale-95"
              >
                ›
              </button>
            </>
          )}

          {/* 삭제 */}
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (!confirm("이 사진을 삭제할까요?")) return;
              const remaining = lightboxPhotos.length - 1;
              await deletePhoto(lightboxPhoto.id);
              if (remaining <= 0) {
                setLightbox(null);
              } else {
                setLightbox({
                  placeId: lightbox.placeId,
                  index: Math.min(lightboxIndex, remaining - 1),
                });
              }
            }}
            className="absolute bottom-6 px-5 py-2.5 rounded-full bg-red-500/90 text-white text-sm font-medium active:scale-95"
          >
            🗑 사진 삭제
          </button>
        </div>
      )}
    </div>
  );
}
