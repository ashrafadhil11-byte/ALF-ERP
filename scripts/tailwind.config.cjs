// Build the shared stylesheet (replaces the in-browser Tailwind CDN, which was slow on every page):
//   npx tailwindcss@3.4.19 -c scripts/tailwind.config.cjs -i scripts/tailwind.in.css -o assets/app.css --minify
// Re-run after adding new Tailwind classes to any page.
module.exports = {
    content: ['./*.html', './admin/**/*.html', './admin/**/*.js'],
    theme: { extend: {
        fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'] },
        colors: {
            coral: { 50: '#FFF5F3', 100: '#FFE8E3', 200: '#FFD0C7', 300: '#F7A99A', 400: '#F08A76', 500: '#E86D58', 600: '#D55C48' },
            brand: { orange: '#F58220', orangeHover: '#E06D10', purple: '#6A2C70', purpleDark: '#4A1D4E', light: '#F8F9FA' }
        },
        boxShadow: { soft: '0 20px 40px -15px rgba(0,0,0,0.05)', glow: '0 10px 25px -5px rgba(245, 130, 32, 0.4)' }
    } }
};
