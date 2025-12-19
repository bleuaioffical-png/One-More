
import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../contexts/RestaurantContext';
import { TenantAccount } from '../types';

export const SuperAdminDashboard: React.FC = () => {
  const { tenants, addTenant, deleteTenant, logout, syncNow, isSyncing } = useRestaurant();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTenant, setNewTenant] = useState({ id: '', name: '', ownerName: '' });
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Auto-sync when entering dashboard to get latest cafe list
  useEffect(() => {
    syncNow();
  }, []);

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenant.id || !newTenant.name) return;
    addTenant({
      id: newTenant.id.toLowerCase().replace(/\s+/g, '-'),
      name: newTenant.name,
      ownerName: newTenant.ownerName
    });
    setNewTenant({ id: '', name: '', ownerName: '' });
    setIsAddModalOpen(false);
  };

  const copyTenantUrl = (id: string) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const fullUrl = `${baseUrl}?id=${id}`;
    navigator.clipboard.writeText(fullUrl);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white font-body selection:bg-white/10">
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-8 flex justify-between items-center">
            <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-white flex items-center justify-center rounded-2xl text-black font-black text-lg shadow-2xl">M</div>
                <div>
                    <h1 className="text-sm font-black uppercase tracking-[0.4em]">Master Registry</h1>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`}></div>
                      <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                        {isSyncing ? 'Cloud Synchronizing...' : 'Platform Connection Optimal'}
                      </span>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-6">
              <button 
                onClick={() => setIsAddModalOpen(true)}
                className="px-8 py-3 bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all"
              >
                + Provision Cafe
              </button>
              <button onClick={logout} className="text-[10px] font-black text-white/40 hover:text-white uppercase tracking-widest transition-colors">Terminate Session</button>
            </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="p-10 bg-white/5 border border-white/10 rounded-[2.5rem] backdrop-blur-sm group hover:border-white/30 transition-all">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-4">Live Ecosystem</p>
                <h4 className="text-4xl font-black">{tenants.length} <span className="text-lg text-white/20">CAFES</span></h4>
            </div>
            <div className="p-10 bg-white/5 border border-white/10 rounded-[2.5rem] backdrop-blur-sm group hover:border-white/30 transition-all">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-4">Cloud Uplink</p>
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]"></div>
                    <h4 className="text-xl font-black uppercase tracking-widest">Active</h4>
                </div>
            </div>
            <div className="p-10 bg-white/5 border border-white/10 rounded-[2.5rem] backdrop-blur-sm group hover:border-white/30 transition-all">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-4">Security Protocol</p>
                <h4 className="text-xl font-black uppercase tracking-widest">E2E Encrypted</h4>
            </div>
        </div>

        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-10">
                <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/40">Registered Tenants</h3>
                <div className="flex-1 h-[1px] bg-white/5"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tenants.map(tenant => (
                    <div key={tenant.id} className="bg-white/5 border border-white/5 rounded-[2rem] p-8 group hover:bg-white/[0.07] transition-all relative overflow-hidden animate-fadeIn">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rotate-45 translate-x-16 -translate-y-16 group-hover:bg-white/10 transition-colors"></div>
                        
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-8">
                                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center font-black text-xs">{tenant.name[0]}</div>
                                <span className={`text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${tenant.status === 'ACTIVE' ? 'border-green-500/30 text-green-500' : 'border-red-500/30 text-red-500'}`}>
                                    {tenant.status}
                                </span>
                            </div>

                            <h3 className="text-lg font-black uppercase tracking-tight mb-1">{tenant.name}</h3>
                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-6">{tenant.id}</p>

                            <div className="space-y-4 mb-8">
                                <div className="flex justify-between text-[9px] uppercase tracking-widest">
                                    <span className="text-white/20">Owner</span>
                                    <span className="font-bold">{tenant.ownerName}</span>
                                </div>
                                <div className="flex justify-between text-[9px] uppercase tracking-widest">
                                    <span className="text-white/20">Provisioned</span>
                                    <span className="font-bold">{new Date(tenant.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <a 
                                      href={`?id=${tenant.id}`}
                                      target="_blank"
                                      className="flex-1 bg-white text-black text-center py-3 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white/90 transition-all"
                                    >
                                      Launch
                                    </a>
                                    <button 
                                      onClick={() => copyTenantUrl(tenant.id)}
                                      className={`flex-1 border text-center py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${copyFeedback === tenant.id ? 'bg-green-500 border-green-500 text-white' : 'border-white/10 text-white/60 hover:border-white/30'}`}
                                    >
                                      {copyFeedback === tenant.id ? 'Copied!' : 'Copy Link'}
                                    </button>
                                </div>
                                <button 
                                  onClick={() => { if(window.confirm(`Permanently delete ${tenant.name}?`)) deleteTenant(tenant.id); }}
                                  className="w-full py-2.5 text-[8px] font-black text-white/20 hover:text-red-500 uppercase tracking-widest transition-all"
                                >
                                  Terminate Entity
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {tenants.length === 0 && !isSyncing && (
                    <div className="col-span-full py-32 border border-dashed border-white/10 rounded-[3rem] text-center">
                        <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.5em]">Platform Registry Empty</p>
                    </div>
                )}
            </div>
        </div>
      </main>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn">
            <div className="bg-[#111] border border-white/10 w-full max-w-sm rounded-[2.5rem] p-12 shadow-2xl">
                <h3 className="text-lg font-black uppercase tracking-widest mb-2">Deploy New Instance</h3>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-10">Isolation & Cloud Mapping</p>

                <form onSubmit={handleCreateTenant} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase text-white/20 tracking-widest">Business Name</label>
                        <input required value={newTenant.name} onChange={e => setNewTenant({...newTenant, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-xs font-bold outline-none focus:border-white transition-all" placeholder="e.g. Green Leaf Cafe" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase text-white/20 tracking-widest">Unique ID (URL Friendly)</label>
                        <input required value={newTenant.id} onChange={e => setNewTenant({...newTenant, id: e.target.value.toLowerCase().replace(/\s+/g, '-')})} className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-xs font-bold outline-none focus:border-white transition-all" placeholder="e.g. green-leaf" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase text-white/20 tracking-widest">Administrator Name</label>
                        <input required value={newTenant.ownerName} onChange={e => setNewTenant({...newTenant, ownerName: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-xs font-bold outline-none focus:border-white transition-all" placeholder="Owner Full Name" />
                    </div>

                    <div className="flex gap-4 pt-6">
                        <button type="button" onClick={() => setIsAddModalOpen(false)} className="flex-1 text-[9px] font-black uppercase text-white/20 hover:text-white transition-colors">Abort</button>
                        <button type="submit" className="flex-[2] py-4 bg-white text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg">Provision</button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
