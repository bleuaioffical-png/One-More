
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { MenuItem, Order, OrderStatus, Category, DiscountMilestone, RestaurantSettings, ActivityEntry, TenantAccount } from '../types';
import { MENU_ITEMS, INITIAL_SETTINGS } from '../constants';

interface RestaurantContextType {
  tenantId: string;
  menuItems: MenuItem[];
  categories: string[];
  orders: Order[];
  lastPlacedOrder: Order | null;
  discountMilestones: DiscountMilestone[];
  settings: RestaurantSettings;
  activityLog: ActivityEntry[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  tenants: TenantAccount[];
  isSyncing: boolean;
  syncError: string | null;
  lastSyncTime: number;
  login: (password: string) => 'ADMIN' | 'SUPER' | 'NONE';
  logout: () => void;
  addTenant: (tenant: Omit<TenantAccount, 'createdAt' | 'status'>) => void;
  deleteTenant: (id: string) => void;
  addMenuItem: (item: MenuItem) => void;
  updateMenuItem: (item: MenuItem) => void;
  deleteMenuItem: (id: string) => void;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  updateDiscountMilestones: (milestones: DiscountMilestone[]) => void;
  updateSettings: (newSettings: RestaurantSettings) => void;
  placeOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  toggleOrderTakeaway: (orderId: string) => void;
  clearHistory: () => void;
  importBusinessData: (data: string) => boolean;
  exportBusinessData: () => string;
  syncNow: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

// High-availability JSON storage
const CLOUD_API_BASE = 'https://jsonblob.com/api/jsonBlob';
// The "DNS" blob that stores the mapping of all restaurant IDs to their data blobs
const MASTER_DISCOVERY_BLOB = '1344265415712161792'; 

// Utility for resilient cloud communication
const safeFetch = async (url: string, options: RequestInit = {}, retries = 2): Promise<Response> => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
    });
    
    if (!response.ok && retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return safeFetch(url, options, retries - 1);
    }
    return response;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return safeFetch(url, options, retries - 1);
    }
    throw err;
  }
};

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || 'main-branch';
  });

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<RestaurantSettings>(INITIAL_SETTINGS);
  const [discountMilestones, setDiscountMilestones] = useState<DiscountMilestone[]>([]);
  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  
  const stateRef = useRef({ menuItems, categories, orders, discountMilestones, settings, tenants, activityLog });
  const lastUpdateRef = useRef<number>(Number(localStorage.getItem(`last_update_${tenantId}`)) || Date.now());
  const syncIntervalRef = useRef<number | null>(null);
  const cloudIdRef = useRef<string | null>(localStorage.getItem(`cloud_blob_${tenantId}`));

  useEffect(() => {
    stateRef.current = { menuItems, categories, orders, discountMilestones, settings, tenants, activityLog };
  }, [menuItems, categories, orders, discountMilestones, settings, tenants, activityLog]);

  const syncWithCloud = async (forcePush = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);

    try {
      // 1. DISCOVERY: Resolve the cloud location
      let discoveryMap: Record<string, any> = {};
      try {
        const dRes = await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`);
        if (dRes.ok) discoveryMap = await dRes.json();
      } catch (e) { 
        console.warn("Registry sync failed, continuing with local pointers");
      }

      if (discoveryMap[tenantId]) {
        cloudIdRef.current = discoveryMap[tenantId];
        localStorage.setItem(`cloud_blob_${tenantId}`, cloudIdRef.current!);
      }

      // 2. MASTER REGISTRY SYNC (Super Admin only)
      if (isSuperAdmin) {
        if (forcePush) {
          await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
            method: 'PUT',
            body: JSON.stringify({ ...discoveryMap, tenants_list: stateRef.current.tenants })
          });
        } else if (discoveryMap.tenants_list) {
          setTenants(discoveryMap.tenants_list);
        }
      }

      // 3. DATA SYNC
      const currentState = {
        ...stateRef.current,
        lastUpdate: forcePush ? Date.now() : lastUpdateRef.current
      };

      if (!cloudIdRef.current) {
        // Create new storage
        const res = await safeFetch(CLOUD_API_BASE, {
          method: 'POST',
          body: JSON.stringify(currentState)
        });
        const location = res.headers.get('Location');
        const newId = location?.split('/').pop();
        if (newId) {
          cloudIdRef.current = newId;
          localStorage.setItem(`cloud_blob_${tenantId}`, newId);
          // Register in Discovery
          await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
            method: 'PUT',
            body: JSON.stringify({ ...discoveryMap, [tenantId]: newId })
          });
        }
      } else {
        // Fetch/Update remote state
        const res = await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`);
        if (!res.ok) {
          if (res.status === 404) { cloudIdRef.current = null; return; }
          throw new Error('Storage disconnected');
        }
        const remoteData = await res.json();
        const remoteTime = remoteData.lastUpdate || 0;

        // MERGE: Orders
        const remoteOrders = remoteData.orders || [];
        const mergedOrders = [...stateRef.current.orders];
        let hasNewData = false;

        remoteOrders.forEach((ro: Order) => {
          const idx = mergedOrders.findIndex(lo => lo.id === ro.id);
          if (idx === -1) {
            mergedOrders.push(ro);
            hasNewData = true;
          } else if (ro.timestamp > mergedOrders[idx].timestamp) {
            // Update if remote is newer (e.g. status change)
            mergedOrders[idx] = ro;
            hasNewData = true;
          }
        });

        // MERGE: Config (Last write wins)
        if (remoteTime > lastUpdateRef.current && !forcePush) {
          if (remoteData.menuItems) setMenuItems(remoteData.menuItems);
          if (remoteData.categories) setCategories(remoteData.categories);
          if (remoteData.settings) setSettings(remoteData.settings);
          if (remoteData.discountMilestones) setDiscountMilestones(remoteData.discountMilestones);
          if (remoteData.activityLog) setActivityLog(remoteData.activityLog);
          lastUpdateRef.current = remoteTime;
          localStorage.setItem(`last_update_${tenantId}`, remoteTime.toString());
        }

        if (hasNewData) {
          setOrders(mergedOrders.sort((a, b) => b.timestamp - a.timestamp));
        }

        // Push if local state is newer or we merged new orders
        if (forcePush || (lastUpdateRef.current > remoteTime) || hasNewData) {
          await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`, {
            method: 'PUT',
            body: JSON.stringify({
              ...currentState,
              orders: mergedOrders,
              lastUpdate: lastUpdateRef.current
            })
          });
        }
      }
      setLastSyncTime(Date.now());
    } catch (err: any) {
      // Suppress noisy 'Failed to fetch' in UI, show only in console
      if (err.message !== 'Failed to fetch') {
        setSyncError(err.message);
      }
      console.error('Cloud Sync Warning:', err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // Lifecycle & Persistence
  useEffect(() => {
    const loadLocal = () => {
      const keys = {
          menu: `menu_db_${tenantId}`,
          orders: `orders_db_${tenantId}`,
          cats: `categories_db_${tenantId}`,
          discounts: `discounts_db_${tenantId}`,
          settings: `settings_db_${tenantId}`,
          logs: `activity_db_${tenantId}`,
          tenants: 'master_tenants_registry'
      };

      try {
        const savedMenu = localStorage.getItem(keys.menu);
        const savedOrders = localStorage.getItem(keys.orders);
        const savedCats = localStorage.getItem(keys.cats);
        const savedDiscounts = localStorage.getItem(keys.discounts);
        const savedSettings = localStorage.getItem(keys.settings);
        const savedTenants = localStorage.getItem(keys.tenants);
        const savedLogs = localStorage.getItem(keys.logs);
        
        if (savedMenu) setMenuItems(JSON.parse(savedMenu));
        else setMenuItems([...MENU_ITEMS]);
        
        if (savedCats) setCategories(JSON.parse(savedCats));
        else setCategories(Object.values(Category));

        if (savedOrders) setOrders(JSON.parse(savedOrders));
        if (savedDiscounts) setDiscountMilestones(JSON.parse(savedDiscounts));
        if (savedSettings) setSettings(JSON.parse(savedSettings));
        if (savedTenants) setTenants(JSON.parse(savedTenants));
        if (savedLogs) setActivityLog(JSON.parse(savedLogs));
      } catch (e) {
        setMenuItems([...MENU_ITEMS]);
        setCategories(Object.values(Category));
      }
      setIsInitialized(true);
    };
    loadLocal();
  }, [tenantId]);

  useEffect(() => {
    if (!isInitialized) return;
    const interval = window.setInterval(() => syncWithCloud(), 5000);
    syncWithCloud();
    return () => clearInterval(interval);
  }, [isInitialized, tenantId, isSuperAdmin]);

  useEffect(() => {
    if (!isInitialized) return;
    const keys = {
        menu: `menu_db_${tenantId}`,
        orders: `orders_db_${tenantId}`,
        cats: `categories_db_${tenantId}`,
        discounts: `discounts_db_${tenantId}`,
        settings: `settings_db_${tenantId}`,
        logs: `activity_db_${tenantId}`,
        tenants: 'master_tenants_registry'
    };
    localStorage.setItem(keys.menu, JSON.stringify(menuItems));
    localStorage.setItem(keys.cats, JSON.stringify(categories));
    localStorage.setItem(keys.orders, JSON.stringify(orders));
    localStorage.setItem(keys.discounts, JSON.stringify(discountMilestones));
    localStorage.setItem(keys.settings, JSON.stringify(settings));
    localStorage.setItem(keys.tenants, JSON.stringify(tenants));
    localStorage.setItem(keys.logs, JSON.stringify(activityLog));
  }, [menuItems, categories, orders, discountMilestones, settings, tenants, activityLog, tenantId, isInitialized]);

  const triggerUpdate = () => {
    lastUpdateRef.current = Date.now();
    localStorage.setItem(`last_update_${tenantId}`, lastUpdateRef.current.toString());
    syncWithCloud(true);
  };

  const logActivity = (type: ActivityEntry['type'], entity: ActivityEntry['entity'], description: string) => {
    const entry: ActivityEntry = {
      id: Math.random().toString(36).substr(2, 9),
      type, entity, description,
      timestamp: Date.now()
    };
    setActivityLog(prev => [entry, ...prev].slice(0, 50));
  };

  const login = (password: string) => {
    if (password === 'superadmin789') { setIsSuperAdmin(true); setIsAdmin(false); return 'SUPER'; }
    if (password === 'admin123') { setIsAdmin(true); setIsSuperAdmin(false); return 'ADMIN'; }
    return 'NONE';
  };

  const logout = () => { setIsAdmin(false); setIsSuperAdmin(false); };

  const addTenant = (tenantData: Omit<TenantAccount, 'createdAt' | 'status'>) => {
    const newTenant: TenantAccount = { ...tenantData, createdAt: Date.now(), status: 'ACTIVE' };
    setTenants(prev => [...prev, newTenant]);
    setTimeout(() => triggerUpdate(), 100);
  };

  const deleteTenant = (id: string) => {
    setTenants(prev => prev.filter(t => t.id !== id));
    setTimeout(() => triggerUpdate(), 100);
  };

  const addMenuItem = (item: MenuItem) => { setMenuItems(prev => [...prev, item]); logActivity('CREATE', 'MENU_ITEM', `Added dish: ${item.name}`); triggerUpdate(); };
  const updateMenuItem = (updated: MenuItem) => { setMenuItems(prev => prev.map(i => i.id === updated.id ? updated : i)); logActivity('UPDATE', 'MENU_ITEM', `Updated dish: ${updated.name}`); triggerUpdate(); };
  const deleteMenuItem = (id: string) => { const it = menuItems.find(i => i.id === id); setMenuItems(prev => prev.filter(i => i.id !== id)); if(it) logActivity('DELETE', 'MENU_ITEM', `Deleted: ${it.name}`); triggerUpdate(); };

  const addCategory = (name: string) => { if (!name.trim()) return; setCategories(prev => prev.includes(name.trim()) ? prev : [...prev, name.trim()]); logActivity('CREATE', 'CATEGORY', `Added category: ${name}`); triggerUpdate(); };
  const renameCategory = (oldN: string, newN: string) => {
    setCategories(prev => prev.map(c => c === oldN ? newN : c));
    setMenuItems(prev => prev.map(i => i.category === oldN ? { ...i, category: newN } : i));
    logActivity('UPDATE', 'CATEGORY', `Renamed ${oldN} to ${newN}`);
    triggerUpdate();
  };
  const removeCategory = (name: string) => { setCategories(prev => prev.filter(c => c !== name)); setMenuItems(prev => prev.filter(i => i.category !== name)); logActivity('DELETE', 'CATEGORY', `Deleted category: ${name}`); triggerUpdate(); };

  const updateDiscountMilestones = (ms: DiscountMilestone[]) => { setDiscountMilestones([...ms].sort((a,b) => a.threshold - b.threshold)); triggerUpdate(); };
  const updateSettings = (s: RestaurantSettings) => { setSettings(s); logActivity('UPDATE', 'SETTINGS', 'Updated business settings'); triggerUpdate(); };

  const placeOrder = (data: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    const newOrder: Order = { ...data, id: Math.random().toString(36).substr(2, 6).toUpperCase(), status: 'PENDING', timestamp: Date.now() };
    setOrders(prev => [newOrder, ...prev]);
    setLastPlacedOrder(newOrder);
    triggerUpdate();
  };

  const updateOrderStatus = (id: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, timestamp: Date.now() } : o));
    triggerUpdate();
  };

  const toggleOrderTakeaway = (id: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id === id) {
        const next = !o.isTakeaway;
        const diff = next ? settings.packingCharge : -settings.packingCharge;
        return { ...o, isTakeaway: next, packingCharge: next ? settings.packingCharge : 0, total: o.total + diff, timestamp: Date.now() };
      }
      return o;
    }));
    triggerUpdate();
  };

  const clearHistory = () => { setActivityLog([]); triggerUpdate(); };
  const exportBusinessData = () => JSON.stringify({ menuItems, categories, settings, discountMilestones });
  const importBusinessData = (json: string) => {
    try {
      const d = JSON.parse(json);
      if (d.menuItems) setMenuItems(d.menuItems);
      if (d.categories) setCategories(d.categories);
      if (d.settings) setSettings(d.settings);
      triggerUpdate();
      return true;
    } catch (e) { return false; }
  };

  return (
    <RestaurantContext.Provider value={{
      tenantId, menuItems, categories, orders, lastPlacedOrder, discountMilestones, settings, activityLog,
      isAdmin, isSuperAdmin, tenants, isSyncing, syncError, lastSyncTime, login, logout, addTenant, deleteTenant,
      addMenuItem, updateMenuItem, deleteMenuItem, addCategory, removeCategory, renameCategory,
      updateDiscountMilestones, updateSettings, placeOrder, updateOrderStatus, toggleOrderTakeaway,
      clearHistory, exportBusinessData, importBusinessData, syncNow: () => syncWithCloud(true)
    }}>
      {children}
    </RestaurantContext.Provider>
  );
};

export const useRestaurant = () => {
  const context = useContext(RestaurantContext);
  if (!context) throw new Error('useRestaurant must be used within Provider');
  return context;
};
