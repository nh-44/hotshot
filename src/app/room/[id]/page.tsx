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

type ResultRow = {
  players: { name: string };
  options: { text: string };
  questions: { text: string };
};

/* ================= COMPONENT ================= */

export default function RoomPage() {
  const { id: roomId } = useParams();

  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionLimit, setNewQuestionLimit] = useState(10);

  const isHost =
    room?.host_session === getSessionToken("host");

  /* ================= FETCH ROOM ================= */

  useEffect(() => {
    if (!roomId) return;

    supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single()
      .then(({ data }) => setRoom(data));
  }, [roomId]);

  /* ================= FETCH QUESTIONS ================= */

  useEffect(() => {
    if (!roomId) return;

    supabase
      .from("questions")
      .select("*")
      .eq("room_id", roomId)
      .order("order_index")
      .then(({ data }) => {
        const qs = data || [];
        setQuestions(qs);
        setActiveQuestion(qs.find(q => q.status === "open") || null);
        setLoading(false);
      });
  }, [roomId]);

  /* ================= FETCH OPTIONS ================= */

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
      alert("Failed to join");
      return;
    }

    setJoined(true);
  };

  /* ================= HOST ACTIONS ================= */

  const publishRoom = async () => {
    const { data } = await supabase
      .from("rooms")
      .update({ status: "live" })
      .eq("id", roomId)
      .select()
      .single();

    setRoom(data);
  };

  const addQuestion = async () => {
    if (!newQuestionText.trim()) return;

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

  const openQuestion = async (qid: string) => {
    await supabase
      .from("questions")
      .update({ status: "closed" })
      .eq("room_id", roomId);

    await supabase
      .from("questions")
      .update({ status: "open" })
      .eq("id", qid);

    setHasVoted(false);
    setResults([]);
  };

  const closeQuestion = async () => {
    if (!activeQuestion) return;

    await supabase
      .from("questions")
      .update({ status: "closed" })
      .eq("id", activeQuestion.id);

    fetchResults(activeQuestion.id);
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

    const sessionToken = getSessionToken(roomId as string);

    const { data: player } = await supabase
      .from("players")
      .select("id")
      .eq("room_id", roomId)
      .eq("session_token", sessionToken)
      .single();

    await supabase.from("votes").insert({
      room_id: roomId,
      question_id: activeQuestion.id,
      option_id: optionId,
      player_id: player.id,
    });

    await supabase
      .from("options")
      .update({ votes_count: supabase.raw("votes_count + 1") })
      .eq("id", optionId);

    await markVoted();
  };

  const addOptionAndVote = async (text: string) => {
    if (!text.trim() || !activeQuestion || hasVoted) return;

    const { data: option, error } = await supabase
      .from("options")
      .insert({
        question_id: activeQuestion.id,
        text,
        votes_count: 1,
      })
      .select()
      .single();

    if (!error) {
      voteOption(option.id);
    }
  };

  /* ================= RESULTS ================= */

  const fetchResults = async (questionId: string) => {
    const { data } = await supabase
      .from("votes")
      .select(`
        players(name),
        options(text),
        questions(text)
      `)
      .eq("question_id", questionId);

    setResults(data || []);
  };

  const downloadCSV = () => {
    const header = "Question,Player,Option\n";
    const body = results
      .map(
        r =>
          `"${r.questions.text}","${r.players.name}","${r.options.text}"`
      )
      .join("\n");

    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotshot-results.csv";
    a.click();
  };

  /* ================= RENDER ================= */

  if (loading) return <div className="p-10 text-white">Loading…</div>;

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

        <h1 className="text-2xl font-bold mb-4">{room?.room_name}</h1>

        {isHost && room?.status === "draft" && (
          <button
            disabled={questions.length === 0}
            onClick={publishRoom}
            className="w-full bg-green-600 py-2 rounded font-bold mb-4"
          >
            Publish Room
          </button>
        )}

        {isHost && room?.status === "draft" && (
          <div className="bg-slate-800 p-4 rounded mb-4">
            <input
              className="w-full p-3 mb-3 rounded bg-slate-700"
              placeholder="Question"
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

        {isHost && questions.map(q => (
          <div key={q.id} className="flex justify-between mb-2">
            <span>{q.order_index}. {q.text}</span>
            {q.status === "closed" && (
              <button
                onClick={() => openQuestion(q.id)}
                className="text-green-400 font-bold"
              >
                Open
              </button>
            )}
          </div>
        ))}

        {activeQuestion ? (
          <>
            <h2 className="text-xl font-bold mb-4">
              {activeQuestion.text}
            </h2>

            {options.map(opt => (
              <div
                key={opt.id}
                onClick={() => voteOption(opt.id)}
                className="bg-slate-800 p-3 rounded mb-2 flex justify-between cursor-pointer"
              >
                <span>{opt.text}</span>
                <span>{opt.votes_count}</span>
              </div>
            ))}

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
          <>
            {!isHost && (
              <div className="text-center mt-10">
                <h2 className="text-2xl font-bold text-green-400">
                  🎉 Yay! You completed it
                </h2>
                <p className="text-slate-400 mt-2">
                  Waiting for the next question…
                </p>
              </div>
            )}

            {isHost && results.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xl font-bold mb-3">Results</h3>

                {results.map((r, i) => (
                  <div
                    key={i}
                    className="flex justify-between bg-slate-800 p-2 rounded mb-2"
                  >
                    <span>{r.players.name}</span>
                    <span className="text-orange-400">
                      {r.options.text}
                    </span>
                  </div>
                ))}

                <button
                  onClick={downloadCSV}
                  className="mt-4 bg-green-600 px-4 py-2 rounded font-bold"
                >
                  Download Results (CSV)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
