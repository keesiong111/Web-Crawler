import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { z } from "zod";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Database Setup ---
const db = new Database("crawler.db");
db.pragma("journal_mode = WAL");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    start_urls TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    max_depth INTEGER DEFAULT 2,
    max_pages INTEGER DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    url TEXT NOT NULL,
    parent_url TEXT,
    depth INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    http_status INTEGER,
    fetch_mode TEXT DEFAULT 'static',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS raw_pages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    url TEXT NOT NULL,
    content TEXT,
    headers TEXT,
    content_type TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT,
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS extracted_records (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    url TEXT NOT NULL,
    page_type TEXT,
    title TEXT,
    content TEXT,
    author TEXT,
    publish_time TEXT,
    tags TEXT,
    images TEXT,
    links TEXT,
    structured_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(page_id) REFERENCES raw_pages(id)
  );
`);

// --- Crawler Types & Schemas ---
const CrawlJobSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  startUrls: z.array(z.string().url()),
  maxDepth: z.number().int().min(0).max(5).default(2),
  maxPages: z.number().int().min(1).max(50000).default(100),
  priority: z.number().int().default(0),
});

// --- AI Setup (Server-side helper for prompt construction, but SDK used in frontend context usually, 
// however for background crawler jobs, we use it here securely) ---
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// --- Express Server ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  
  // Create Job
  app.post("/api/jobs", (req, res) => {
    try {
      const data = CrawlJobSchema.parse(req.body);
      const jobId = crypto.randomUUID();
      
      const insertJob = db.prepare(`
        INSERT INTO jobs (id, name, description, start_urls, max_depth, max_pages, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertJob.run(
        jobId,
        data.name,
        data.description || "",
        JSON.stringify(data.startUrls),
        data.maxDepth,
        data.maxPages,
        data.priority
      );

      // Create initial tasks
      const insertTask = db.prepare(`
        INSERT INTO tasks (id, job_id, url, depth, status)
        VALUES (?, ?, ?, ?, 'pending')
      `);

      for (const url of data.startUrls) {
        insertTask.run(crypto.randomUUID(), jobId, url, 0);
      }

      // Start crawler in "background" (async)
      runCrawler(jobId).catch(console.error);

      res.json({ id: jobId, status: "pending" });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Get All Jobs
  app.get("/api/jobs", (req, res) => {
    const jobs = db.prepare(`
      SELECT j.*, 
        (SELECT count(*) FROM tasks WHERE job_id = j.id) as total_tasks,
        (SELECT count(*) FROM tasks WHERE job_id = j.id AND status = 'completed') as success_tasks,
        (SELECT count(*) FROM tasks WHERE job_id = j.id AND status = 'failed') as failed_tasks
      FROM jobs j 
      ORDER BY created_at DESC
    `).all();
    res.json(jobs);
  });

  // Get Job Detail
  app.get("/api/jobs/:id", (req, res) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    
    const tasks = db.prepare("SELECT * FROM tasks WHERE job_id = ? LIMIT 100").all(req.params.id);
    const metrics = db.prepare(`
      SELECT 
        count(*) as total,
        sum(case when status = 'completed' then 1 else 0 end) as success,
        sum(case when status = 'failed' then 1 else 0 end) as failed,
        sum(case when status = 'pending' then 1 else 0 end) as pending
      FROM tasks WHERE job_id = ?
    `).get(req.params.id);

    res.json({ job, tasks, metrics });
  });

  // Get Extracted Data
  app.get("/api/data", (req, res) => {
    const { jobId, limit = 50, offset = 0, search = "" } = req.query;
    let query = "SELECT * FROM extracted_records";
    const params: any[] = [];

    if (jobId || search) {
      query += " WHERE 1=1";
      if (jobId) {
        query += " AND page_id IN (SELECT id FROM raw_pages WHERE task_id IN (SELECT id FROM tasks WHERE job_id = ?))";
        params.push(jobId);
      }
      if (search) {
        query += " AND (title LIKE ? OR content LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const records = db.prepare(query).all(...params);
    res.json(records);
  });

  // Job Controls
  app.post("/api/jobs/:id/pause", (req, res) => {
    db.prepare("UPDATE jobs SET status = 'paused' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/jobs/:id/resume", (req, res) => {
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(req.params.id);
    runCrawler(req.params.id).catch(console.error);
    res.json({ success: true });
  });

  app.post("/api/jobs/:id/retry", (req, res) => {
    db.prepare("UPDATE tasks SET status = 'pending' WHERE job_id = ? AND status = 'failed'").run(req.params.id);
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(req.params.id);
    runCrawler(req.params.id).catch(console.error);
    res.json({ success: true });
  });

  // Export Data
  app.get("/api/export", (req, res) => {
    const { jobId, format = "json" } = req.query;
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const records = db.prepare(`
      SELECT * FROM extracted_records 
      WHERE page_id IN (SELECT id FROM raw_pages WHERE task_id IN (SELECT id FROM tasks WHERE job_id = ?))
    `).all(jobId);

    if (format === "csv") {
      // Simple CSV generation
      if (records.length === 0) return res.send("");
      const headers = Object.keys(records[0] as any).join(",");
      const rows = records.map(r => Object.values(r as any).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=export_${jobId}.csv`);
      return res.send(`${headers}\n${rows}`);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=export_${jobId}.json`);
    res.json(records);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// --- Crawler Logic ---
async function runCrawler(jobId: string) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as any;
  if (!job) return;

  db.prepare("UPDATE jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);

  const limit = pLimit(5); // Concurrency 5
  let pagesCrawled = 0;

  while (pagesCrawled < job.max_pages) {
    const task = db.prepare(`
      SELECT * FROM tasks 
      WHERE job_id = ? AND status = 'pending' 
      ORDER BY depth ASC, created_at ASC 
      LIMIT 1
    `).get(jobId) as any;

    if (!task) break;

    // Mark as processing
    db.prepare("UPDATE tasks SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);

    await limit(async () => {
      try {
        console.log(`Crawling: ${task.url}`);
        const result = await fetchPage(task.url);
        
        // Save raw page
        const pageId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO raw_pages (id, task_id, url, content, headers, content_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(pageId, task.id, task.url, result.content, JSON.stringify(result.headers), result.contentType);

        // Parse & Extract
        const extracted = await parseContent(result.content, task.url);
        
        db.prepare(`
          INSERT INTO extracted_records (id, page_id, url, page_type, title, content, author, publish_time, tags, images, links, structured_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(), 
          pageId, 
          task.url, 
          extracted.pageType,
          extracted.title,
          extracted.content,
          extracted.author,
          extracted.publishTime,
          JSON.stringify(extracted.tags),
          JSON.stringify(extracted.images),
          JSON.stringify(extracted.links),
          JSON.stringify(extracted.structured)
        );

        // Extract internal links for next depth
        if (task.depth < job.max_depth) {
          const baseUrl = new URL(task.url);
          extracted.links.forEach((link: string) => {
            try {
              const absoluteUrl = new URL(link, task.url).toString();
              // Only crawl same domain and avoid fragment/query duplicates if needed
              if (new URL(absoluteUrl).hostname === baseUrl.hostname) {
                // Check if already in tasks
                const exists = db.prepare("SELECT 1 FROM tasks WHERE job_id = ? AND url = ?").get(jobId, absoluteUrl);
                if (!exists) {
                  db.prepare(`
                    INSERT INTO tasks (id, job_id, url, depth, status)
                    VALUES (?, ?, ?, ?, 'pending')
                  `).run(crypto.randomUUID(), jobId, absoluteUrl, task.depth + 1);
                }
              }
            } catch (e) {}
          });
        }

        db.prepare("UPDATE tasks SET status = 'completed', http_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(result.status, task.id);
        pagesCrawled++;
      } catch (error) {
        console.error(`Failed to crawl ${task.url}:`, error);
        db.prepare("UPDATE tasks SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run((error as Error).message, task.id);
      }
    });

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 1000));
  }

  db.prepare("UPDATE jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
}

async function fetchPage(url: string) {
  // Simple Robots.txt check (very basic for MVP)
  try {
    const robotsUrl = new URL("/robots.txt", url).toString();
    const robotsRes = await fetch(robotsUrl).catch(() => null);
    if (robotsRes && robotsRes.ok) {
      const robotsText = await robotsRes.text();
      if (robotsText.includes("Disallow: /")) {
        // This is a naive check, but signals intent for compliance
        // For a real app, use a robots-parser library.
        console.log(`Robots.txt disallows some paths on ${new URL(url).hostname}`);
      }
    }

    const response = await fetch(url, { headers: { "User-Agent": "UniversalWebCrawler/1.0" } });
    const content = await response.text();
    const contentType = response.headers.get("content-type") || "";
    
    // If it looks like it needs JS (low content size or common markers), we could use Playwright
    // But for MVP, let's keep it simple or allow a flag.
    return {
      content,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      contentType
    };
  } catch (error) {
    throw error;
  }
}

async function parseContent(html: string, url: string) {
  const $ = cheerio.load(html);
  
  const title = $("title").text() || $("h1").first().text();
  const content = $("article").text() || $("main").text() || $("body").text();
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });

  const images: string[] = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) images.push(src);
  });

  // Simple heuristic or AI can go here
  return {
    title: title.trim().substring(0, 200),
    content: content.trim().substring(0, 2000),
    pageType: "page",
    author: "",
    publishTime: "",
    tags: [],
    images: images.slice(0, 10),
    links: Array.from(new Set(links)),
    structured: {}
  };
}

startServer();
