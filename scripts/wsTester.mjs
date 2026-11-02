#!/usr/bin/env node

const url = process.env.WS_URL || 'ws://localhost:3000/ws';
const message = process.env.MESSAGE || 'Hello';
const resumeToken = process.argv[2];

const ws = new WebSocket(url);
const send = (frame) => ws.send(JSON.stringify(frame));
const fail = (text) => {
  console.error(`FAIL ${text}`);
  process.exit(1);
};
const timer = setTimeout(() => fail('timed out'), 180_000);
let step = 'hello';

ws.addEventListener('open', () => {
  console.log(`Testing WebSocket at ${url}\n`);
  send({ type: 'hello', ...(resumeToken && { sessionToken: resumeToken }) });
});

ws.addEventListener('message', ({ data }) => {
  const frame = JSON.parse(data);
  if (frame.type === 'token') return process.stdout.write(frame.token);
  if (frame.type === 'error' && step !== 'unknown') fail(`${frame.code}: ${frame.error}`);

  switch (step) {
    case 'hello':
      if (frame.type !== 'session') fail(`expected session, got ${frame.type}`);
      console.log(`OK   session ${frame.sessionToken.slice(0, 12)}... expires ${frame.expiresAt}`);
      step = 'message';
      process.stdout.write('     ');
      return send({ type: 'message', id: 'm1', text: message });
    case 'message':
      if (frame.type !== 'reply' || frame.id !== 'm1') fail(`expected reply m1, got ${frame.type}`);
      console.log(`\nOK   reply (${frame.messageCount} messages in session)`);
      step = 'history';
      return send({ type: 'history' });
    case 'history':
      if (frame.type !== 'history' || frame.messages.length < 2) fail('expected history');
      console.log(`OK   history (${frame.messages.length} stored messages)`);
      step = 'unknown';
      return send({ type: 'nope' });
    case 'unknown':
      if (frame.type !== 'error' || frame.code !== 'unknown_type')
        fail('expected unknown_type error');
      console.log('OK   unknown frame rejected');
      step = 'ping';
      return send({ type: 'ping' });
    case 'ping':
      if (frame.type !== 'pong') fail('expected pong');
      console.log('OK   ping/pong\n\nAll WebSocket tests passed.');
      clearTimeout(timer);
      return ws.close();
  }
});

ws.addEventListener('error', () => fail('connection error'));
