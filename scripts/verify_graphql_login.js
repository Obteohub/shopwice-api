const BASE_URL = 'https://api.shopwice.com';
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function verifyLoginMutation() {
    console.log('🚀 Testing GraphQL Login Mutation...');
    
    const query = `
        mutation Login($input: LoginInput!) {
            login(input: $input) {
                token
                user {
                    id
                    username
                    email
                    firstName
                    lastName
                    role
                }
            }
        }
    `;

    const variables = {
        input: {
            username: USERNAME,
            password: PASSWORD
        }
    };

    try {
        // Use local dev server if running locally, otherwise remote
        // Since we are running in the context of the project, let's assume we want to test the *implementation* which is currently local.
        // Wait, the user asked to fix it, so I updated the code.
        // To test it, I need to run it against the local worker.
        // But the previous test script used the live URL.
        // I should probably test against 127.0.0.1:8788 if I'm running `npm run dev`
        // But I don't have a background process running `npm run dev` in this session yet (or do I? check terminals).
        // Terminal 3 is idle. Terminal 2 and 6 were running `npm run dev` in previous context but I should check.
        
        // Let's assume we want to test against the *local* server to verify the fix before deploying.
        // I will start a dev server in background if needed.
        
        const LOCAL_URL = 'http://127.0.0.1:8788/graphql';
        console.log(`Target: ${LOCAL_URL}`);

        const res = await fetch(LOCAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            if (json.errors) {
                console.error('❌ GraphQL Errors:', JSON.stringify(json.errors, null, 2));
            } else {
                console.log('✅ Login Successful!');
                console.log('Token:', json.data.login.token.substring(0, 20) + '...');
                console.log('User:', json.data.login.user);
            }
        } catch (e) {
            console.error('❌ Invalid JSON:', text.substring(0, 200));
        }

    } catch (e) {
        console.error('❌ Request Error:', e.message);
        console.log('Make sure `npm run dev` is running!');
    }
}

verifyLoginMutation();
