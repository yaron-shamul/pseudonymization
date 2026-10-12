import amqp from 'amqplib';
import axios from 'axios';

// RabbitMQ worker that forwards ANONYMIZE/DEANONYMIZE messages to the NestJS API via HTTP.
// Message body is the same JSON the HTTP API accepts:
//   { "data": {...} | [...], "fields": ["name", "email"], "idField": "id" }

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost';
const API_BASE = process.env.API_BASE || 'http://localhost:3000/pseudonymization';
const MAX_ATTEMPTS = 3;

const ROUTES = { ANONYMIZE: 'anonymize', DEANONYMIZE: 'deanonymize' };

async function connectWithRetry(retries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(RABBIT_URL);
    } catch (e) {
      if (i >= retries) throw e;
      console.log(`RabbitMQ not ready (${e.message}), retry ${i}/${retries}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function start() {
  const conn = await connectWithRetry();
  const ch = await conn.createChannel();

  for (const [q, route] of Object.entries(ROUTES)) {
    await ch.assertQueue(q, { durable: true });
    await ch.assertQueue(`${q}_DLQ`, { durable: true });

    ch.consume(q, async (msg) => {
      if (!msg) return;
      const attempts = (msg.properties.headers?.['x-attempts'] || 0) + 1;
      try {
        const body = JSON.parse(msg.content.toString());
        const res = await axios.post(`${API_BASE}/${route}`, body);
        console.log(`${q} ok`, JSON.stringify(res.data));
        ch.ack(msg);
      } catch (err) {
        const status = err.response?.status;
        console.error(`${q} failed (attempt ${attempts})`, status ?? '', err.response?.data ?? err.message);
        // Client errors (bad JSON / bad request) will never succeed -> straight to DLQ
        const permanent = err instanceof SyntaxError || (status >= 400 && status < 500);
        if (permanent || attempts >= MAX_ATTEMPTS) {
          ch.sendToQueue(`${q}_DLQ`, msg.content, { persistent: true, headers: { 'x-attempts': attempts } });
        } else {
          ch.sendToQueue(q, msg.content, { persistent: true, headers: { 'x-attempts': attempts } });
        }
        ch.ack(msg);
      }
    }, { noAck: false });
    console.log(`Listening on queue ${q}`);
  }
}

start().catch((e) => {
  console.error('Worker failed', e);
  process.exit(1);
});
