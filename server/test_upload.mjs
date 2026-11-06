const BASE = 'http://localhost:8787';

function log(msg, data) {
  console.log(msg);
  console.log('   ', typeof data === 'string' ? data : JSON.stringify(data, null, 2).slice(0, 500));
}

async function main() {
  // Step 1: Health check
  console.log('=== Step 1: Health Check ===');
  const health = await fetch(`${BASE}/api/health`).then(r => r.json());
  log('Health:', health);

  // Step 2: MTProto config
  console.log('\n=== Step 2: MTProto Config ===');
  const config = await fetch(`${BASE}/api/mt/config`).then(r => r.json());
  log('Config:', config);

  if (!config.enabled) {
    console.log('❌ MTProto is not configured. Set MT_API_ID and MT_API_HASH in .env');
    return;
  }

  // Step 3: Start phone login
  console.log('\n=== Step 3: Send Phone Code ===');
  const sendRes = await fetch(`${BASE}/api/mt/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+919099999999' }),
  });
  const sendData = await sendRes.json();
  log('Send code response:', sendData);

  if (sendData.error) {
    console.log('❌ Failed to send code:', sendData.error);
    return;
  }

  const flowId = sendData.flowId;
  console.log(`✅ Code sent! Flow ID: ${flowId}`);
  console.log('📱 Check your Telegram app for the login code');

  // For automated testing, we'd need the code from the user
  // Since we can't get it here, let's stop and tell the user
  console.log('\n=== Next Steps ===');
  console.log('1. Check your Telegram app for the 5-digit code');
  console.log('2. Run: curl -X POST http://localhost:8787/api/mt/verify-code -H "Content-Type: application/json" -d {"flowId":"' + flowId + '","code":"YOUR_CODE"}');
  console.log('3. Then create a category and upload a file');
}

main().catch(console.error);