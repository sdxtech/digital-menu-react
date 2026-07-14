import React from 'react';

const MaintenancePage: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#f8fafc',
      fontFamily: 'sans-serif',
      padding: '20px',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: '64px', marginBottom: '20px' }}>🚧</div>
      <h1 style={{ color: '#1e3a8a', fontSize: '2rem', marginBottom: '10px', fontWeight: 'bold' }}>
        System Under Maintenance
      </h1>
      <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '500px', margin: '0 0 24px 0', lineHeight: '1.5' }}>
        Our developers are currently running scheduled system upgrades to serve you better. 
        We'll be back online shortly!
      </p>
      <div style={{ 
        fontSize: '0.9rem',
        color: '#94a3b8',
        borderTop: '1px solid #e2e8f0',
        paddingTop: '16px',
        width: '100%',
        maxWidth: '300px'
      }}>
        Thank you for your patience.
      </div>
    </div>
  );
};

export default MaintenancePage;