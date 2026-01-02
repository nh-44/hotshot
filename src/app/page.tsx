"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { getSessionToken } from "@/lib/session";

export default function Home() {
  const [roomName, setRoomName] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return alert("Enter room name");

    setLoading(true);

    const hostSession = getSessionToken("host");

    const { data, error } = await supabase
      .from("rooms")
      .insert({
        room_name: roomName,
        host_session: hostSession,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("Failed to create room");
      setLoading(false);
      return;
    }

    router.push(`/room/${data.id}`);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 text-white p-6">
      <form
        onSubmit={createRoom}
        className="w-full max-w-md bg-slate-800 p-8 rounded-xl"
      >
        <h1 className="text-3xl font-bold mb-6 text-orange-500">🔥 HotShot</h1>

        <input
          className="w-full p-3 mb-4 rounded bg-slate-700"
          placeholder="Room name (e.g. Rotaract Icebreaker)"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
        />

        <button
          disabled={loading}
          className="w-full bg-orange-600 py-3 rounded font-bold"
        >
          {loading ? "Creating…" : "Create Room"}
        </button>
      </form>
    </main>
  );
}
