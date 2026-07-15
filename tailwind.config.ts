import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        card: "0 14px 40px rgba(14, 43, 48, 0.1)",
      },
    },
  },
  plugins: [],
};

export default config;
