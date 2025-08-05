# Railway Deployment Guide for MineCash Backend

## 🚀 Quick Deploy to Railway

### 1. **Prepare Your Repository**
```bash
# Ensure all files are committed
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### 2. **Deploy to Railway**

#### Option A: Railway CLI
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link your project
railway link

# Deploy
railway up
```

#### Option B: Railway Dashboard
1. Go to [railway.app](https://railway.app)
2. Create new project
3. Connect your GitHub repository
4. Select the `backend` folder as the source

### 3. **Configure Environment Variables**

In Railway dashboard, set these environment variables:

#### **Required Variables:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=3000
WS_HOST=0.0.0.0
WS_PORT=8080
```

#### **Optional Variables:**
```
CORS_ORIGIN=https://www.minecash.org
RATE_LIMIT_WINDOW=60000
MAX_REQUESTS_PER_WINDOW=100
DEBUG=false
```

### 4. **Get Your Supabase Keys**

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
   - **anon key** → `SUPABASE_ANON_KEY`

### 5. **Update Frontend Configuration**

After deployment, update your frontend environment variables:

```env
# In your frontend .env
VITE_BACKEND_URL=https://your-railway-app.railway.app
VITE_WS_URL=wss://your-railway-app.railway.app
```

## 🔧 Configuration Details

### **Port Configuration**
- Railway automatically assigns a `PORT` environment variable
- Your app will use `process.env.PORT` if available
- WebSocket runs on the same port as HTTP in production

### **Health Check**
- Railway will check `/health` endpoint
- Returns: `{ status: 'ok', timestamp: '...', version: '1.0.0' }`

### **CORS Configuration**
- Set `CORS_ORIGIN` to your frontend domain
- For Minecash: `https://www.minecash.org`
- For development: `http://localhost:3000,https://www.minecash.org`

## 🐛 Troubleshooting

### **Common Issues:**

1. **Build Fails**
   - Check Node.js version compatibility
   - Ensure all dependencies are in `package.json`

2. **Environment Variables Missing**
   - Verify all required variables are set in Railway dashboard
   - Check variable names match exactly

3. **Database Connection Fails**
   - Verify Supabase URL and keys are correct
   - Check if Supabase project is active

4. **WebSocket Connection Issues**
   - Ensure frontend uses correct WebSocket URL
   - Check CORS configuration

### **Logs & Debugging:**
```bash
# View Railway logs
railway logs

# Check deployment status
railway status
```

## 📊 Monitoring

### **Health Check Endpoint:**
```
GET https://your-app.railway.app/health
```

### **Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

## 🔄 Updates & Redeployment

### **Automatic Deployments:**
- Railway automatically redeploys on git push
- No manual intervention required

### **Manual Redeploy:**
```bash
railway up
```

## ✅ Success Checklist

- [ ] Backend deploys without errors
- [ ] Health check endpoint responds
- [ ] Environment variables are set correctly
- [ ] Supabase connection works
- [ ] Frontend can connect to backend
- [ ] WebSocket connections work
- [ ] Game functionality is operational

## 🆘 Support

If you encounter issues:
1. Check Railway logs for error messages
2. Verify environment variables are set correctly
3. Test Supabase connection locally first
4. Contact Railway support if needed

---

**Your backend is now ready for Railway deployment! 🚀** 