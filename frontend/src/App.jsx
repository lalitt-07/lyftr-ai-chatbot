
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
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  function newChat() {
    setMessages([]);
    setMessage("");
    setError("");
    setSystemPrompt("");
    setSessionId(crypto.randomUUID());
  }

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
        headers: { "Content-Type": "application/json" },
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
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">L</div>
          <span>LYFTR<span className="brand-light"> AI</span></span>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <button className="new-chat-button" onClick={newChat}>
          <span>＋</span> New conversation
        </button>

        <div className="sidebar-label recent-label">YOUR SPACE</div>

        <div className="sidebar-item active">
          <span>◈</span> AI Assistant
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="online-dot"></span>
            AI systems operational
          </div>
          <div className="sidebar-version">LYFTR AI · FULL STACK</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>AI Assistant</strong>
          </div>
          <div className="topbar-status">
            <span className="online-dot"></span> All systems online
          </div>
        </header>

        <section className="conversation">
          <div className="chat-heading">
            <div>
              <div className="eyebrow">YOUR AI WORKSPACE</div>
              <h1>AI Assistant</h1>
              <p>Think, explore, and create with Lyftr AI.</p>
            </div>
            <div className="model-chip">
              <span className="model-dot"></span>
              Gemini · Connected
            </div>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="welcome">
                <div className="welcome-symbol">✳</div>
                <div className="eyebrow">WELCOME TO LYFTR</div>
                <h2>Where should we start?</h2>
                <p>
                  Ask a question, explore an idea, or work through
                  something complicated. I'm here to help.
                </p>
              </div>
            )}

            {messages.map((item, index) => (
              <div className="message-group" key={index}>
                {item.role === "user" ? (
                  <div className="message user">
                    {item.content}
                  </div>
                ) : (
                  <>
                    <div
                      className="message assistant"
                      data-testid="assistant-message"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.content}
                      </ReactMarkdown>
                    </div>

                    {item.metadata && (
                      <div className="metadata">
                        <span data-testid="meta-source">
                          {item.metadata.resolution_source}
                        </span>
                        <span data-testid="meta-model">
                          {item.metadata.model}
                        </span>
                        <span data-testid="meta-latency">
                          {item.metadata.latency_ms} ms
                        </span>
                        <span data-testid="meta-input-tokens">
                          In: {item.metadata.input_tokens}
                        </span>
                        <span data-testid="meta-output-tokens">
                          Out: {item.metadata.output_tokens}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {loading && (
              <div className="message assistant thinking">
                <span className="thinking-dot"></span>
                Lyftr is thinking...
              </div>
            )}

            {error && <div className="error-message">{error}</div>}
          </div>

          <div className="composer-area">
            <div className="system-prompt">
              <label htmlFor="system-prompt">SYSTEM INSTRUCTIONS · OPTIONAL</label>
              <textarea
                id="system-prompt"
                data-testid="system-prompt-input"
                placeholder="Guide how Lyftr should respond..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
              />
            </div>

            <form className="chat-form" onSubmit={sendMessage}>
              <input
                data-testid="chat-input"
                type="text"
                placeholder="Message Lyftr AI..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={loading}
              />
              <button
                data-testid="send-button"
                type="submit"
                disabled={!message.trim() || loading}
              >
                ↑
              </button>
            </form>

            <p className="composer-note">
              AI can make mistakes. Verify important information.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
