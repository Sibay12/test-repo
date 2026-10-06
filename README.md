# TaknaDocs – PAN / FSSAI / GST (Hindi + English)
TAKNA Technology (www.takna.online) का प्रोडक्ट। मेन साइट से जोड़ने के लिए सबसे आसान: Render में Custom Domain `docs.takna.online` लगाएँ (DNS में CNAME), और मेन साइट के मेन्यू में इसका लिंक दें।

ग्राहक: फॉर्म भरे → दस्तावेज़ अपलोड → ऑनलाइन भुगतान (TaknaPay UPI) → अपने-आप Tracking ID → ट्रैक/डाउनलोड।
एडमिन (`/admin.html`): New Orders → स्टेटस बदलें, ARN/नोट डालें, तैयार दस्तावेज़ अपलोड करें, कीमतें बदलें।

## Render पर चलाना (GitHub से)
1. इस फोल्डर को GitHub repo में push करें।
2. Render → New → Blueprint (`render.yaml`) चुनें। ध्यान दें: अपलोड की फाइलें और ऑर्डर बचाने के लिए **Persistent Disk** चाहिए, जो paid plan में मिलता है (render.yaml में लगा है)।
3. Environment Variables भरें:
   - `ADMIN_PASSWORD` – कम से कम 8 अक्षर, मज़बूत रखें
   - `SITE_URL` – इस साइट का https पता (जैसे `https://docs.takna.online`), बिना अंत के `/`
   - `TAKNAPAY_API_KEY` – TaknaPay merchant dashboard में दिखने वाली API key (अपने गेटवे पर खुद के लिए `API_SECRET_KEY`)
4. TaknaPay में अपनी साइट रजिस्टर करें (`/merchant.html`) — साइट का पता `SITE_URL` वाला ही दें, क्योंकि ग्राहक को लौटाना सिर्फ़ रजिस्टर्ड साइट पर होता है। Webhook URL में `https://आपकी-साइट/api/payment-webhook` डालें और dashboard के "Send test" से जाँचें। (webhook backup है: ग्राहक भुगतान के बाद पेज बंद कर दे तब भी ऑर्डर पक्का हो जाता है।)
5. `https://आपकी-साइट/admin.html` खोलें → Pricing में हर सेवा का शुल्क डालें। जिस सेवा का शुल्क ₹0 है, उसका ऑनलाइन ऑर्डर नहीं हो सकता।

## लोकल टेस्ट (बिना असली पेमेंट के)
```
npm install
ADMIN_PASSWORD=test12345 DEMO_PAYMENTS=1 node server.js
```
`DEMO_PAYMENTS` में भुगतान नकली होता है (सीधे सफल दिखता है); `NODE_ENV=production` में यह बंद रहता है।

## ज़रूरी बातें
- कीमत सर्वर तय करता है (ग्राहक बदल नहीं सकता)। भुगतान की पुष्टि हमेशा TaknaPay के check-status से (और signed webhook से) होती है, ब्राउज़र के redirect पर भरोसा नहीं किया जाता। अधूरे (बिना भुगतान) ऑर्डर और उनकी फाइलें 72 घंटे बाद अपने-आप हट जाती हैं।
- ट्रैकिंग के लिए Tracking ID + मोबाइल दोनों चाहिए। फाइलें सिर्फ़ PDF/JPG/PNG (5 MB), एडमिन का तैयार दस्तावेज़ 10 MB तक।
- डेटा `DATA_DIR` में JSON फाइलों में रहता है (छोटे व्यवसाय के लिए ठीक)। ऑर्डर बहुत बढ़ें तो डेटाबेस पर जाएँ।
- फोन/ईमेल/WhatsApp नंबर `public/index.html` में बदलें (PHONE और फुटर)।
- ग्राहकों के दस्तावेज़ निजी जानकारी हैं: Privacy Policy और Refund Policy पेज जोड़ें (पेमेंट गेटवे/KYC में भी काम आते हैं)।

## अपना डोमेन (docs.takna.online) लगाना
1. Render → आपकी service → Settings → Custom Domains → Add → `docs.takna.online`
2. Render जो CNAME पता दिखाए (जैसे `takna-docs.onrender.com`), उसे अपने डोमेन के DNS पैनल में CNAME रिकॉर्ड बनाएँ: Name = `docs`, Value = वह पता। (`docs` नाम का कोई पुराना रिकॉर्ड हो तो हटा दें; Cloudflare में proxy/orange cloud पहले बंद रखें।)
3. Render में "Verify" दबाएँ — HTTPS सर्टिफिकेट अपने-आप लग जाता है।
4. `SITE_URL=https://docs.takna.online` करें, TaknaPay में साइट और webhook का पता भी यही दें।
5. मेन साइट (www.takna.online) के मेन्यू में इस पते का लिंक जोड़ दें।

## इनवॉइस PDF (अपने-आप)
भुगतान की पुष्टि होते ही हर ऑर्डर का इनवॉइस PDF अपने-आप बन जाता है (Tracking ID के साथ)। ग्राहक इसे भुगतान-सफल पेज और ट्रैकिंग पेज से, और आप एडमिन में हर ऑर्डर से डाउनलोड कर सकते हैं।
इनवॉइस पर आपका पता/ईमेल/फोन/GSTIN छपे, इसके लिए Render में `BIZ_ADDRESS`, `BIZ_EMAIL`, `BIZ_PHONE`, `BIZ_GSTIN` डालें (सब वैकल्पिक)।
ध्यान दें: इनवॉइस अंग्रेज़ी में है; ग्राहक का नाम हिंदी (देवनागरी) में हो तो वह इनवॉइस पर "Customer" दिखेगा (मोबाइल नंबर दिखेगा)। GST का हिसाब (टैक्स ब्रेकअप) अपने CA से पूछकर तय करें।
