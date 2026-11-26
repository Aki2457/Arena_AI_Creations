// Public Supabase settings used ONLY for Realtime signaling (WebRTC offers/answers/ICE).
// The publishable key is designed to be exposed in browser code. Never put a secret
// or service_role key here.
window.VOICE_CHAT_CONFIG = {
  supabaseUrl: "https://vkepbzwwmmycgguyvnyg.supabase.co",
  supabaseKey: "sb_publishable_p5eUsO21uFLenoW_V8Hb0Q_tyJ5d8Qh",
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};
