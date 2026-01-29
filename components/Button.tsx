
import React, { useRef, useState } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  as?: React.ElementType;
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  loading, 
  className = '', 
  as: Component = 'button',
  onClick,
  ...props 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);

  const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();
    
    setRipples(prev => [...prev, { x, y, id }]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== id));
    }, 600);
  };

  const baseStyles = "relative inline-flex items-center justify-center font-bold transition-all duration-300 active:scale-95 disabled:opacity-40 disabled:pointer-events-none rounded-2xl overflow-hidden cursor-pointer tracking-wide group";
  
  const variants = {
    primary: "bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white shadow-[0_10px_20px_-5px_rgba(79,70,229,0.5)] hover:shadow-[0_15px_30px_-5px_rgba(79,70,229,0.6)] hover:-translate-y-1",
    secondary: "bg-slate-800/80 text-indigo-100 hover:bg-slate-700 border border-slate-700/50 backdrop-blur-sm shadow-xl",
    danger: "bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-[0_10px_20px_-5px_rgba(244,63,94,0.4)] hover:shadow-[0_15px_30px_-5px_rgba(244,63,94,0.5)] hover:-translate-y-1",
    outline: "bg-white/5 border-2 border-indigo-500/30 text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/10 shadow-lg"
  };

  const sizes = {
    sm: "px-5 py-2 text-xs",
    md: "px-7 py-3 text-sm",
    lg: "px-10 py-4 text-base"
  };

  const componentProps = {
    ...props,
    onMouseDown: handleMouseDown,
    onClick: onClick,
    className: `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`
  };

  return (
    <Component {...componentProps}>
      {/* Ripple Effects Layer */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {ripples.map(ripple => (
          <span 
            key={ripple.id} 
            className="ripple-effect"
            style={{ left: ripple.x, top: ripple.y, width: 2, height: 2 }}
          />
        ))}
      </div>

      {loading ? (
        <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : null}
      <span className="relative z-10">{children}</span>
      
      {/* Glossy Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
    </Component>
  );
};

export default Button;
