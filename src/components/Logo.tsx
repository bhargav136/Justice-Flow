import React from 'react';

export const JusticeFlowLogo = ({ className = "w-full h-full" }: { className?: string }) => {
  return (
    <svg 
      viewBox="0 0 100 100" 
      className={className}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield Base */}
      <path 
        d="M50 5L10 20V45C10 70 50 95 50 95C50 95 90 70 90 45V20L50 5Z" 
        fill="var(--bg-surface)" 
        stroke="var(--color-brand-accent)" 
        strokeWidth="2"
      />
      
      {/* Brain Icon (Simplified) */}
      <path 
        d="M35 25C30 25 25 30 25 35C25 40 30 43 35 43C35 43 35 45 40 45C45 45 45 43 45 43C50 43 55 40 55 35C55 30 50 25 45 25C45 25 45 23 40 23C35 23 35 25 35 25Z" 
        fill="var(--text-main)" 
        transform="translate(10, 5)"
      />
      <path 
        d="M35 25C30 25 25 30 25 35C25 40 30 43 35 43C35 43 35 45 40 45C45 45 45 43 45 43C50 43 55 40 55 35C55 30 50 25 45 25C45 25 45 23 40 23C35 23 35 25 35 25Z" 
        fill="var(--text-main)" 
        transform="translate(-10, 5) scale(-1, 1) translate(-100, 0)"
      />
      
      {/* Scales of Justice */}
      <g transform="translate(0, 15)">
        {/* Beam */}
        <path d="M30 45H70" stroke="var(--text-main)" strokeWidth="2" strokeLinecap="round"/>
        {/* Center Pillar */}
        <path d="M50 40V65" stroke="var(--text-main)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M45 65H55" stroke="var(--text-main)" strokeWidth="2" strokeLinecap="round"/>
        {/* Left Scale */}
        <path d="M30 45L25 55H35L30 45Z" fill="var(--text-main)"/>
        {/* Right Scale */}
        <path d="M70 45L65 55H75L70 45Z" fill="var(--text-main)"/>
      </g>
      
      {/* Tech Lines */}
      <path d="M15 30H20V40" stroke="var(--color-brand-accent)" strokeWidth="1" strokeLinecap="round"/>
      <path d="M85 30H80V40" stroke="var(--color-brand-accent)" strokeWidth="1" strokeLinecap="round"/>
      
      {/* Glow Point */}
      <circle cx="50" cy="15" r="2" fill="var(--color-brand-accent)">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
};
