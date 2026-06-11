import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shield: {
          white: "#FFFFFF",
          pink: "#E49AB0",
          rose: "#E76C6A",
          plum: "#904C77",
          charcoal: "#1E1E1E"
        }
      },
      fontFamily: {
        poppins: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        phone: "0 24px 80px rgba(30, 30, 30, 0.16)"
      }
    }
  },
  plugins: []
} satisfies Config;
