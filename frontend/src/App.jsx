
import { useState } from "react";
import "./App.css";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function App() {
  const [message, setMessage] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // A new session is created whenever the page is loaded.
  const [sessionId] = useState(() => crypto.randomUUID());

  async function sendMessage(e) {
    e.preventDefault();

    const userMessage = message.trim();

    if (!userMessage || loading) return;

    setMessage("");
    setError("");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: userMessage },
    ]);

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: userMessage,
          ...(systemPrompt.trim()
            ? { system_prompt: systemPrompt.trim() }
            : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Something went wrong.");
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.reply,
          metadata: data.metadata,
        },
      ]);
    } catch (err) {
      setError(err.message || "Unable to connect to the backend.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Lyftr AI</h1>
          <p>Your intelligent AI assistant</p>
        </div>
        <span className="status">● Online</span>
      </header>

      <main className="chat-container">
        <div className="chat-heading">
          <h2>AI Chatbot</h2>
          <span className="status">● Ready to help</span>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="welcome">
              <h2>How can I help you today?</h2>
              <p>
                Ask me anything. I'm ready to assist you.
              </p>
            </div>
          )}

          {messages.map((item, index) => (
            <div key={index}>
              <div
                className={`message ${item.role}`}
                data-testid={
                  item.role === "assistant" ? "assistant-message" : undefined
                }
              >
                {item.role === "assistant" ? (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {item.content}
  </ReactMarkdown>
) : (
  item.content
)}
              </div>

              {item.role === "assistant" && item.metadata && (
                <div className="metadata">
                  <span data-testid="meta-source">
                    {item.metadata.resolution_source}
                  </span>
                  <span data-testid="meta-model">
                    Model: {item.metadata.model}
                  </span>
                  <span data-testid="meta-latency">
                    Latency: {item.metadata.latency_ms} ms
                  </span>
                  <span data-testid="meta-input-tokens">
                    Input: {item.metadata.input_tokens} tokens
                  </span>
                  <span data-testid="meta-output-tokens">
                    Output: {item.metadata.output_tokens} tokens
                  </span>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="message assistant">
              Lyftr AI is thinking...
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="system-prompt">
          <label htmlFor="system-prompt">
            System prompt (optional)
          </label>
          <textarea
            id="system-prompt"
            data-testid="system-prompt-input"
            placeholder="Example: Answer in simple English..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={2}
          />
        </div>

        <form className="chat-form" onSubmit={sendMessage}>
          <input
            data-testid="chat-input"
            type="text"
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
          />

          <button
            data-testid="send-button"
            type="submit"
            disabled={!message.trim() || loading}
          >
            {loading ? "..." : "Send"}
          </button>
        </form>
      </main>

      <footer>Powered by Lyftr AI</footer>
    </div>
  );
}

export default App;
