import express from "express";
import eventBus from "../utils/pm_utils/eventBus.js";

const router = express.Router();

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ✅ listener
  const listener = (payload) => {
    send(payload);
  };

  eventBus.on('session:update', listener);

  // cleanup
  req.on('close', () => {
    eventBus.off('session:update', listener);
  });
});

export default router;