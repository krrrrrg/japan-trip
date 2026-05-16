import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBB1dZQQnhA42-yZ2j58XVH5qRo1pbpjw0",
  authDomain: "japn-e1408.firebaseapp.com",
  projectId: "japn-e1408",
  storageBucket: "japn-e1408.firebasestorage.app",
  messagingSenderId: "25202858988",
  appId: "1:25202858988:web:5d1067b0f10cf522443ec9",
  measurementId: "G-67EXL5PCYE",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
