if (process.argv.includes('--version')) { console.log('slow-fixture 1.0'); process.exit(); }
await new Promise(resolve => setTimeout(resolve, 1800));
await import('./fake-agent.mjs');
