/**
 * useGitHubProfile — Fetches the user's linked GitHub profile.
 * Returns null if no GitHub account is linked.
 */

import { useState, useEffect } from "react";
import { API_BASE_URL } from "../constants";

export interface GitHubProfile {
  login: string;
  avatarUrl: string;
  name: string | null;
  email: string | null;
}

export function useGitHubProfile() {
  const [profile, setProfile] = useState<GitHubProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v2/github/user`, { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        if (data.login) {
          setProfile(data);
        } else {
          setProfile(null);
        }
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading };
}
