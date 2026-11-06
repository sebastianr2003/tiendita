/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,tsx,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#FBF9F5",
        surface: {
          light: "#F3EFE6",
          DEFAULT: "#EAE3D2",
        },
        primary: "#C27803",
        secondary: "#2D5A43",
        text: "#1E293B",
        border: "#DFD7C7",
      },
      fontFamily: {
        title: ["'Bricolage Grotesque'", "sans-serif"],
        data: ["'Space Grotesk'", "monospace"],
      },
      height: {
        screen: "100dvh",
      },
      minHeight: {
        screen: "100dvh",
      },
      maxHeight: {
        screen: "100dvh",
      },
    },
  },
  plugins: [],
}
