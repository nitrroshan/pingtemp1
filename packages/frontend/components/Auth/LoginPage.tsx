/**
 * LoginPage — Simple email/password auth form.
 * Handles both sign-in and sign-up flows.
 */

import React, { useState } from "react";
import { signIn, signUp } from "../../lib/auth-client";

export function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const result = await signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });
        if (result.error) {
          setError(result.error.message || "Sign up failed");
        }
      } else {
        const result = await signIn.email({ email, password });
        if (result.error) {
          setError(result.error.message || "Sign in failed");
        }
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "40px",
          borderRadius: "12px",
          background: "#1e293b",
          border: "1px solid #334155",
          width: "360px",
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, textAlign: "center" }}>
          {"Ping"}
        </h1>
        <p style={{ fontSize: "14px", color: "#94a3b8", margin: 0, textAlign: "center" }}>
          {isSignUp ? "Create a new Ping account" : "Sign in to Ping"}
        </p>

        {isSignUp && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: "13px", margin: 0 }}>{error}</p>
        )}

        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "..." : isSignUp ? "Sign Up" : "Sign In"}
        </button>

        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
          style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "13px" }}
        >
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: "14px",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};
