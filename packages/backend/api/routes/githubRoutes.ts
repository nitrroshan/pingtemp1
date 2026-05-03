/**
 * GitHub routes — repo browser, branches, user profile.
 */

import { Router } from "express";
import { rootLogger } from "../../logging/index.js";
import { safeError } from "./shared.js";
import { getAuth } from "../../auth/index.js";
import { GitHubService } from "../../services/GitHubService.js";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "GitHubRoutes" });

export function createGithubRoutes(services?: ServiceRegistry): Router {
  const router = Router();

  const githubService = new GitHubService(async (userId: string) => {
    const auth = await getAuth();
    try {
      if (services?.db) {
        const account = await services.db.collection("account").findOne({
          userId,
          providerId: "github",
        });
        return account?.accessToken || null;
      }
      return null;
    } catch (err) {
      logger.warn("[GitHubRoutes] Failed to retrieve token:", err);
      return null;
    }
  });

  router.get("/github/repos", async (req: any, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const perPage = Math.min(parseInt(req.query.per_page as string) || 30, 100);
      const type = (req.query.type as string) || "owner";
      const sort = (req.query.sort as string) || "updated";

      const result = await githubService.listRepos(req.userId, { page, perPage, type, sort });
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes("No GitHub account")) {
        res.status(404).json({ error: err.message });
      } else {
        res.status(500).json({ error: safeError(err) });
      }
    }
  });

  router.get("/github/repos/:owner/:repo/branches", async (req: any, res) => {
    try {
      const { owner, repo } = req.params;
      const branches = await githubService.listBranches(req.userId, owner, repo);
      res.json({ branches });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  router.get("/github/user", async (req: any, res) => {
    try {
      const user = await githubService.getUser(req.userId);
      res.json(user);
    } catch (err: any) {
      if (err.message?.includes("No GitHub account")) {
        res.json({ linked: false });
      } else {
        res.status(500).json({ error: safeError(err) });
      }
    }
  });

  logger.info("[GitHubRoutes] Mounted: repos, branches, user");
  return router;
}
