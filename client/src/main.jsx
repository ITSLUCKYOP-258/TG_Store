import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Follow stored theme or OS light/dark preference.
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  const saved = localStorage.getItem('theme');
  const isDark = saved ? saved === 'dark' : darkMedia.matches;
  document.documentElement.classList.toggle('dark', isDark);
};
applyTheme();
darkMedia.addEventListener('change', () => {
  if (!localStorage.getItem('theme')) applyTheme();
});

ReactDOM.createRoot(document.getElementById('root')).render(

  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
