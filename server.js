require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const mime = require("mime-types");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5173;
const INITIAL_ROOT = (process.env.VIDEO_ROOT && path.resolve(process.env.VIDEO_ROOT)) || path.join(os.homedir(), "Videos");
let VIDEO_ROOT = INITIAL_ROOT;

function isVideo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v", ".mkv"].includes(ext);
}

async function walkDirectoryRecursive(directoryPath) {
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const absoluteEntryPath = path.resolve(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkDirectoryRecursive(absoluteEntryPath);
      }
      return isVideo(absoluteEntryPath) ? [absoluteEntryPath] : [];
    })
  );
  return results.flat();
}

function relativeToRoot(absoluteFilePath) {
  return path.relative(VIDEO_ROOT, absoluteFilePath);
}

app.get("/api/videos", async (req, res) => {
  try {
    if (!fs.existsSync(VIDEO_ROOT)) {
      return res.json({ root: VIDEO_ROOT, count: 0, videos: [] });
    }
    const files = await walkDirectoryRecursive(VIDEO_ROOT);
    const videos = await Promise.all(
      files.map(async (absolutePath) => {
        const stats = await fs.promises.stat(absolutePath);
        return {
          relPath: relativeToRoot(absolutePath),
          name: path.basename(absolutePath),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      })
    );
    res.json({ root: VIDEO_ROOT, count: videos.length, videos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to list videos" });
  }
});

app.post("/api/set-root", async (req, res) => {
  try {
    const newRootRaw = (req.body && (req.body.newRoot || req.body.root || req.body.path)) || "";
    if (typeof newRootRaw !== "string" || newRootRaw.trim() === "") {
      return res.status(400).json({ error: "newRoot is required" });
    }
    const candidate = path.resolve(newRootRaw);
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ error: "Path is not an existing directory" });
    }
    VIDEO_ROOT = candidate;
    const files = await walkDirectoryRecursive(VIDEO_ROOT);
    return res.json({ ok: true, root: VIDEO_ROOT, count: files.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to set root" });
  }
});

app.get("/stream", async (req, res) => {
  try {
    const rel = req.query.p;
    if (!rel || typeof rel !== "string" || rel.includes("..")) {
      return res.status(400).send("Bad path");
    }
    const absolutePath = path.resolve(VIDEO_ROOT, rel);
    if (!absolutePath.startsWith(VIDEO_ROOT)) {
      return res.status(403).send("Forbidden");
    }
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).send("Not found");
    }

    const stat = await fs.promises.stat(absolutePath);
    const contentType = mime.lookup(absolutePath) || "application/octet-stream";
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", stat.size);
        return fs.createReadStream(absolutePath).pipe(res);
      }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      fs.createReadStream(absolutePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(absolutePath).pipe(res);
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving videos from: ${VIDEO_ROOT}`);
});
