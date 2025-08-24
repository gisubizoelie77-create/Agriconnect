// main.js

// Import Firebase client modules needed for real-time listeners on the front-end
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, addDoc, setDoc, onSnapshot, collection, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// This is a minimal, self-contained application.
// In a real-world scenario, the API calls would be to a backend server.
// Here, we simulate the backend behavior using Firebase client SDK directly
// and fetch calls that directly communicate with the LLM API.

// Provided environment variables
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let userId = null;
let currentUserRole = null;

// A simple utility to show messages to the user.
const showMessage = (text) => {
    const messageBox = document.getElementById('message-box');
    const messageText = document.getElementById('message-text');
    messageText.textContent = text;
    messageBox.classList.remove('hidden');
};

// DOM elements
const authStatusEl = document.getElementById('auth-status');
const mainContent = document.getElementById('main-content');
const loginContainer = document.getElementById('login-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegisterButton = document.getElementById('show-register-form');
const showLoginButton = document.getElementById('show-login-form');
const logoutButton = document.getElementById('logout-button');
const buyerDashboard = document.getElementById('buyer-dashboard');
const farmerDashboard = document.getElementById('farmer-dashboard');
const productsListBuyer = document.getElementById('products-list-buyer');
const productsListFarmer = document.getElementById('products-list-farmer');
const productForm = document.getElementById('product-form');
const suggestPriceButton = document.getElementById('suggest-price-button');
const productPriceInput = document.getElementById('product-price');
const priceLoadingIndicator = document.getElementById('price-loading');
const microLoanForm = document.getElementById('micro-loan-form');
const logisticsForm = document.getElementById('logistics-form');
const confirmationModal = document.getElementById('confirmation-modal');
const closeModalButton = document.getElementById('close-modal-button');
const productModal = document.getElementById('product-modal');
const closeProductModalButton = document.getElementById('close-product-modal');
const modalProductName = document.getElementById('modal-product-name');
const modalProductDescription = document.getElementById('modal-product-description');
const modalProductPrice = document.getElementById('modal-product-price');
const modalProductOwner = document.getElementById('modal-product-owner');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const loanHistory = document.getElementById('loan-history');
const modalBuyButton = document.getElementById('modal-buy-button');

// A simple utility for exponential backoff retry.
const withRetry = async (fn, retries = 5, delay = 1000) => {
    try {
        return await fn();
    } catch (error) {
        if (retries > 0) {
            console.warn(`Retrying in ${delay}ms...`, error);
            await new Promise(res => setTimeout(res, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

// Event listeners for the message box and modals
document.getElementById('message-close').addEventListener('click', () => {
    document.getElementById('message-box').classList.add('hidden');
});
closeModalButton.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
});
closeProductModalButton.addEventListener('click', () => {
    productModal.classList.add('hidden');
});

// Event listeners for switching between login and register forms
showRegisterButton.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
});
showLoginButton.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

// Handle login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.querySelector('#login-email').value;
    const password = loginForm.querySelector('#login-password').value;

    try {
        await withRetry(() => signInWithEmailAndPassword(auth, email, password));
    } catch (error) {
        console.error("Login failed:", error);
        showMessage("Login failed. Please check your credentials.");
    }
});

// Handle register form submission
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = registerForm.querySelector('#register-email').value;
    const password = registerForm.querySelector('#register-password').value;
    const role = registerForm.querySelector('#user-role').value;

    try {
        const userCredential = await withRetry(() => createUserWithEmailAndPassword(auth, email, password));
        const newUserId = userCredential.user.uid;
        
        const userProfileRef = doc(db, `artifacts/${appId}/users/${newUserId}/profile/user_data`);
        await setDoc(userProfileRef, { email, role, createdAt: new Date().toISOString() });
        
        showMessage("Registration successful! You can now log in.");
        confirmationModal.classList.remove('hidden');
        registerForm.reset();
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } catch (error) {
        console.error("Registration failed:", error);
        showMessage(error.message);
    }
});

// Handle logout
logoutButton.addEventListener('click', async () => {
    await signOut(auth);
});

// Handle product listing form submission (Farmer feature)
productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userId) {
        showMessage("You must be logged in to list a product.");
        return;
    }

    const productName = document.getElementById('product-name').value;
    const productPrice = document.getElementById('product-price').value;
    const productDescription = document.getElementById('product-description').value;

    try {
        const productsCollectionRef = collection(db, `artifacts/${appId}/public/data/products`);
        await addDoc(productsCollectionRef, {
            ownerId: userId,
            name: productName,
            price: parseFloat(productPrice),
            description: productDescription,
            createdAt: new Date().toISOString(),
        });
        showMessage("Product listed successfully!");
        productForm.reset();
    } catch (error) {
        console.error("Error listing product:", error);
        showMessage("Failed to list product.");
    }
});

// AI-Powered Price Recommendation (Farmer feature)
suggestPriceButton.addEventListener('click', async () => {
    const productName = document.getElementById('product-name').value;
    const productDescription = document.getElementById('product-description').value;

    if (!productName || !productDescription) {
        showMessage("Please enter a product name and description before requesting a price.");
        return;
    }

    priceLoadingIndicator.classList.remove('hidden');
    suggestPriceButton.disabled = true;

    try {
        const prompt = `Based on the following produce, suggest a realistic price in Rwandan Francs (RWF) as a single number.
        Product: ${productName}
        Description: ${productDescription}
        Suggested Price (RWF):`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "text/plain" }
        };

        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        
        const response = await withRetry(() => fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }));
        
        const result = await response.json();
        const suggestedPrice = result?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (suggestedPrice) {
            const price = parseFloat(suggestedPrice.replace(/[^0-9.]/g, ''));
            if (!isNaN(price)) {
                productPriceInput.value = price.toFixed(2);
                showMessage("Price suggested by AI successfully!");
            } else {
                throw new Error("Could not parse suggested price.");
            }
        } else {
            throw new Error("API did not return a suggestion.");
        }
    } catch (error) {
        console.error("Error from Gemini API:", error);
        showMessage(error.message);
    } finally {
        priceLoadingIndicator.classList.add('hidden');
        suggestPriceButton.disabled = false;
    }
});

// Simulated Micro-Loan Application (Farmer feature)
microLoanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userId) {
        showMessage("You must be logged in to apply for a loan.");
        return;
    }

    const loanAmount = microLoanForm['loan-amount'].value;
    const loanPurpose = microLoanForm['loan-purpose'].value;

    try {
        const loansCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/loan_applications`);
        await addDoc(loansCollectionRef, {
            amount: parseFloat(loanAmount),
            purpose: loanPurpose,
            status: 'Pending',
            createdAt: new Date().toISOString(),
        });
        showMessage("Loan application submitted successfully!");
        microLoanForm.reset();
    } catch (error) {
        console.error("Error submitting loan application:", error);
        showMessage("Failed to submit loan application.");
    }
});

// Simulated Logistics Request (Farmer feature)
logisticsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userId) {
        showMessage("You must be logged in to request logistics.");
        return;
    }

    const pickupLocation = logisticsForm['pickup-location'].value;
    const deliveryLocation = logisticsForm['delivery-location'].value;

    try {
        // We're just logging this to Firestore to show it's a real action
        const logisticsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/logistics_requests`);
        await addDoc(logisticsCollectionRef, {
            pickup: pickupLocation,
            delivery: deliveryLocation,
            status: 'Requested',
            createdAt: new Date().toISOString(),
        });
        showMessage(`Logistics pickup from ${pickupLocation} to ${deliveryLocation} requested. A partner will be in touch.`);
        logisticsForm.reset();
    } catch (error) {
        console.error("Error submitting logistics request:", error);
        showMessage("Failed to submit logistics request.");
    }
});

// Handle chat message submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageText = chatInput.value;
    if (!userId || !messageText) return;

    try {
        const chatCollectionRef = collection(db, `artifacts/${appId}/public/data/chat`);
        await addDoc(chatCollectionRef, {
            user: userId,
            text: messageText,
            timestamp: Date.now(),
        });
        chatInput.value = ''; // Clear the input field
    } catch (error) {
        console.error("Failed to send chat message:", error);
        showMessage("Failed to send message. Please try again.");
    }
});

// --- Real-time data listeners ---

// Real-time listener for products
const setupProductListener = () => {
    const productsCollectionRef = collection(db, `artifacts/${appId}/public/data/products`);
    onSnapshot(productsCollectionRef, (snapshot) => {
        productsListBuyer.innerHTML = '';
        productsListFarmer.innerHTML = '';
        
        snapshot.docs.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            const productItem = document.createElement('div');
            productItem.classList.add('bg-white', 'p-4', 'rounded-xl', 'shadow-md', 'mb-4', 'cursor-pointer', 'hover:shadow-lg', 'transition-shadow');
            productItem.innerHTML = `
                <h3 class="text-xl font-bold text-gray-800 mb-2">${product.name}</h3>
                <p class="text-gray-600 mb-2">${product.description}</p>
                <p class="text-green-600 font-semibold text-lg mb-2">RWF ${product.price.toFixed(2)}</p>
                <p class="text-sm text-gray-400">Listed by: <span class="font-mono">${product.ownerId}</span></p>
            `;
            
            productItem.addEventListener('click', () => showProductModal(product));
            productsListBuyer.appendChild(productItem.cloneNode(true));
            productsListFarmer.appendChild(productItem);
        });
    });
};

// Real-time listener for loan history
const setupLoanHistoryListener = () => {
    if (!userId) return;
    const loansCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/loan_applications`);
    onSnapshot(loansCollectionRef, (snapshot) => {
        loanHistory.innerHTML = '';
        if (snapshot.empty) {
            loanHistory.innerHTML = '<p>No loan applications found.</p>';
            return;
        }

        snapshot.docs.forEach(doc => {
            const loan = doc.data();
            const loanItem = document.createElement('div');
            loanItem.classList.add('bg-gray-100', 'p-3', 'rounded-lg');
            loanItem.innerHTML = `
                <p><strong>Amount:</strong> RWF ${loan.amount.toFixed(2)}</p>
                <p><strong>Purpose:</strong> ${loan.purpose}</p>
                <p><strong>Status:</strong> <span class="text-yellow-600">${loan.status}</span></p>
            `;
            loanHistory.appendChild(loanItem);
        });
    });
};

// Real-time listener for the community chat
const setupChatListener = () => {
    const chatCollectionRef = collection(db, `artifacts/${appId}/public/data/chat`);
    onSnapshot(chatCollectionRef, (snapshot) => {
        chatMessages.innerHTML = '';
        snapshot.docs.forEach(doc => {
            const message = doc.data();
            const messageContainer = document.createElement('div');
            messageContainer.classList.add('chat-message-container');
            
            const messageElement = document.createElement('div');
            messageElement.classList.add('chat-message');
            messageElement.textContent = message.text;

            const metaElement = document.createElement('div');
            metaElement.classList.add('chat-message-meta');
            metaElement.textContent = `from: ${message.user} at ${new Date(message.timestamp).toLocaleTimeString()}`;

            if (message.user === userId) {
                messageElement.classList.add('self');
                metaElement.classList.add('text-right');
            } else {
                messageElement.classList.add('other');
                metaElement.classList.add('text-left');
            }
            
            messageContainer.appendChild(messageElement);
            messageContainer.appendChild(metaElement);
            chatMessages.appendChild(messageContainer);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to the bottom
    });
};

const showProductModal = (product) => {
    modalProductName.textContent = product.name;
    modalProductDescription.textContent = product.description;
    modalProductPrice.textContent = `RWF ${product.price.toFixed(2)}`;
    modalProductOwner.textContent = product.ownerId;
    
    const newBuyButton = modalBuyButton.cloneNode(true);
    modalBuyButton.parentNode.replaceChild(newBuyButton, modalBuyButton);
    newBuyButton.addEventListener('click', () => {
        showMessage(`You've simulated buying "${product.name}". This feature would typically lead to a checkout process.`);
        productModal.classList.add('hidden');
    });

    productModal.classList.remove('hidden');
};

// Main authentication state change listener
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is signed in.
        userId = user.uid;
        
        // Fetch the user's role from Firestore
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/user_data`);
        const docSnap = await getDoc(userProfileRef);
        
        if (docSnap.exists()) {
            currentUserRole = docSnap.data().role;
            
            authStatusEl.textContent = `Status: Authenticated as ${currentUserRole}`;
            logoutButton.classList.remove('hidden');
            loginContainer.classList.add('hidden');
            mainContent.classList.remove('hidden');
            
            document.getElementById('welcome-message').textContent = `Welcome, ${currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1)}!`;

            if (currentUserRole === 'farmer') {
                farmerDashboard.classList.remove('hidden');
                buyerDashboard.classList.add('hidden');
                setupLoanHistoryListener();
                setupChatListener();
            } else if (currentUserRole === 'buyer') {
                farmerDashboard.classList.add('hidden');
                buyerDashboard.classList.remove('hidden');
            }
            setupProductListener(); // Both roles see the product list
        } else {
            // Case where a user profile does not exist.
            // This can happen if the user is authenticated with a custom token but hasn't registered yet.
            authStatusEl.textContent = `Status: Authenticated (Profile Incomplete)`;
            logoutButton.classList.remove('hidden');
            loginContainer.classList.add('hidden');
            mainContent.classList.remove('hidden');
            document.getElementById('welcome-message').textContent = "Welcome! Please register with your role to continue.";
        }
    } else {
        // User is signed out.
        userId = null;
        currentUserRole = null;
        authStatusEl.textContent = "Status: Not Authenticated";
        logoutButton.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        mainContent.classList.add('hidden');
    }
});

// Handle initial auth with custom token if available
const signIn = async () => {
    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Firebase Auth Error:", error);
        // Handle the error appropriately without an alert
    }
};

// Start the process
signIn();
