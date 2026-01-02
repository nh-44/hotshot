"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getSessionToken } from "@/lib/session";
import AddOption from "./components/AddOption";


/* ================= TYPES ================= */

type Room = {
  id: string;
  room_name: string;
  status: "draft" | "live" | "ended";
  host_session: string | null;
};

type Question = {
  id: string;
  text: string;
  status: "open" | "closed";
  max_options: number;
  order_index: number;
};

type Option = {
  id: string;
  text: string;
  votes_count: number;
};

/* ================= COMPONENT ================= */

export default function RoomPage() {
  const { id: roomId } = useParams();

  /* ---------- Core State ---------- */
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  /* ---------- Player State ---------- */
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  /* ---------- Host Question Creation ---------- */
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionLimit, setNewQuestionLimit] = useState(10);

  const isHost =
    room?.host_session === getSessionToken("host");

  /* ================= FETCH ROOM ================= */

  useEffect(() => {
    if (!roomId) return;

    const fetchRoom = async () => {
      const { data } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      setRoom(data);
    };

    fetchRoom();
  }, [roomId]);

  /* ================= FETCH QUESTIONS ================= */

  useEffect(() => {
    if (!roomId) return;

    const fetchQuestions = async () => {
      const { data } = await supabase
        .from("questions")
        .select("*")
        .eq("room_id", roomId)
        .order("order_index");

      const qs = data || [];
      setQuestions(qs);
      setActiveQuestion(qs.find(q => q.status === "open") || null);
      setLoading(false);
    };

    fetchQuestions();
  }, [roomId]);

  /* ================= FETCH OPTIONS (REALTIME) ================= */

  useEffect(() => {
    if (!activeQuestion) {
      setOptions([]);
      return;
    }

    const fetchOptions = async () => {
      const { data } = await supabase
        .from("options")
        .select("*")
        .eq("question_id", activeQuestion.id)
        .order("votes_count", { ascending: false });

      setOptions(data || []);
    };

    fetchOptions();

    const channel = supabase
      .channel(`options-${activeQuestion.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "options",
          filter: `question_id=eq.${activeQuestion.id}`,
        },
        fetchOptions
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeQuestion]);

  /* ================= JOIN ROOM ================= */

  const joinRoom = async () => {
    if (!name.trim()) return alert("Enter your name");

    const sessionToken = getSessionToken(roomId as string);

    const { error } = await supabase.from("players").insert({
      room_id: roomId,
      name,
      session_token: sessionToken,
    });

    if (error && error.code !== "23505") {
      console.error(error);
      alert("Failed to join");
      return;
    }

    setJoined(true);
  };

  /* ================= HOST ACTIONS ================= */

  const publishRoom = async () => {
  const { data, error } = await supabase
    .from("rooms")
    .update({ status: "live" })
    .eq("id", roomId)
    .select()
    .single();

  if (error) {
    console.error(error);
    alert("Failed to publish room");
    return;
  }

  setRoom(data); // ✅ THIS IS THE KEY LINE
};


  const addQuestion = async () => {
    if (!newQuestionText.trim()) return alert("Enter a question");

    const nextOrder =
      questions.length > 0
        ? Math.max(...questions.map(q => q.order_index)) + 1
        : 1;

    await supabase.from("questions").insert({
      room_id: roomId,
      text: newQuestionText,
      max_options: newQuestionLimit,
      status: "closed",
      order_index: nextOrder,
    });

    setNewQuestionText("");
  };

  const openQuestion = async (questionId: string) => {
    await supabase
      .from("questions")
      .update({ status: "closed" })
      .eq("room_id", roomId)
      .eq("status", "open");

    await supabase
      .from("questions")
      .update({ status: "open" })
      .eq("id", questionId);

    setHasVoted(false);
  };

  const closeQuestion = async () => {
    if (!activeQuestion) return;

    await supabase
      .from("questions")
      .update({ status: "closed" })
      .eq("id", activeQuestion.id);

    setActiveQuestion(null);
    setHasVoted(false);
  };

  /* ================= VOTING ================= */

  const markVoted = async () => {
    const sessionToken = getSessionToken(roomId as string);

    await supabase
      .from("players")
      .update({
        has_voted: true,
        current_question_id: activeQuestion?.id,
      })
      .eq("room_id", roomId)
      .eq("session_token", sessionToken);

    setHasVoted(true);
  };

  const voteOption = async (optionId: string) => {
    if (!activeQuestion || hasVoted) return;

    await supabase
      .from("options")
      .update({ votes_count: supabase.raw("votes_count + 1") })
      .eq("id", optionId);

    await markVoted();
  };

  const addOptionAndVote = async (text: string) => {
    if (!text.trim() || !activeQuestion || hasVoted) return;

    const { error } = await supabase.from("options").insert({
      question_id: activeQuestion.id,
      text,
      votes_count: 1,
    });

    if (error && error.code === "23505") {
      await supabase
        .from("options")
        .update({ votes_count: supabase.raw("votes_count + 1") })
        .ilike("text", text.trim())
        .eq("question_id", activeQuestion.id);
    }

    await markVoted();
  };

  /* ================= RENDER ================= */

  if (loading) {
    return <div className="p-10 text-white">Loading…</div>;
  }

  if (!joined && room?.status === "live") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded">
          <h1 className="text-xl font-bold mb-4">{room.room_name}</h1>
          <input
            className="w-full p-3 mb-4 rounded bg-slate-700"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={joinRoom}
            className="w-full bg-orange-600 py-3 rounded font-bold"
          >
            Join Room
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-xl mx-auto">

        <h1 className="text-2xl font-bold mb-2">{room?.room_name}</h1>

        {room?.status === "live" && (
          <div className="mb-4 text-center">
            <code className="bg-slate-800 px-3 py-1 rounded">
              {typeof window !== "undefined" && window.location.href}
            </code>
            <button
              onClick={() =>
                navigator.clipboard.writeText(window.location.href)
              }
              className="ml-2 bg-slate-700 px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
        )}

        {/* HOST: PUBLISH */}
        {isHost && room?.status === "draft" && (
          <div className="mb-6 bg-slate-800 p-4 rounded">
            <button
              disabled={questions.length === 0 || room.status !== "draft"}
              onClick={publishRoom}
              className="w-full bg-green-600 py-2 rounded font-bold disabled:opacity-50"
            >
              Publish Room
            </button>
          </div>
        )}

        {/* HOST: ADD QUESTIONS */}
        {isHost && room?.status === "draft" && (
          <div className="mb-6 bg-slate-800 p-4 rounded">
            <input
              className="w-full p-3 mb-3 rounded bg-slate-700"
              placeholder="Question text"
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
            />

            <select
              className="w-full p-3 mb-3 rounded bg-slate-700"
              value={newQuestionLimit}
              onChange={(e) => setNewQuestionLimit(Number(e.target.value))}
            >
              <option value={5}>5 options</option>
              <option value={10}>10 options</option>
              <option value={15}>15 options</option>
            </select>

            <button
              onClick={addQuestion}
              className="w-full bg-orange-600 py-2 rounded font-bold"
            >
              Add Question
            </button>
          </div>
        )}

        {/* QUESTIONS LIST */}
        {isHost && questions.length > 0 && (
          <ul className="mb-6 space-y-2">
            {questions.map(q => (
              <li
                key={q.id}
                className="flex justify-between bg-slate-800 p-3 rounded"
              >
                <span>{q.order_index}. {q.text}</span>
                {q.status === "closed" && (
                  <button
                    onClick={() => openQuestion(q.id)}
                    className="text-green-400 font-bold"
                  >
                    Open
                  </button>
                )}
                {q.status === "open" && (
                  <span className="text-orange-400 font-bold">LIVE</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* ACTIVE QUESTION */}
        {activeQuestion ? (
          <>
            <h2 className="text-xl font-bold mb-4">
              {activeQuestion.text}
            </h2>

            <ul className="space-y-3 mb-4">
              {options.map(opt => (
                <li
                  key={opt.id}
                  onClick={() => voteOption(opt.id)}
                  className={`p-4 rounded flex justify-between ${
                    hasVoted
                      ? "bg-slate-800 opacity-70"
                      : "bg-slate-800 hover:bg-slate-700 cursor-pointer"
                  }`}
                >
                  <span>{opt.text}</span>
                  <span>{opt.votes_count}</span>
                </li>
              ))}
            </ul>

            {!hasVoted &&
              options.length < activeQuestion.max_options && (
                <AddOption onAdd={addOptionAndVote} />
              )}

            {isHost && (
              <button
                onClick={closeQuestion}
                className="mt-4 bg-red-600 px-4 py-2 rounded"
              >
                Close Question
              </button>
            )}
          </>
        ) : (
          room?.status === "live" && (
            <p className="text-center text-slate-400">
              Waiting for the host to start the next question…
            </p>
          )
        )}
      </div>
    </main>
  );
}
