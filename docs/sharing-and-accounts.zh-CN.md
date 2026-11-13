# 日拾 · 分享给朋友 & 账号功能设置指南

按顺序做一遍，大约 20 分钟。做完后：朋友打开网址就能注册自己的账号，每个人的数据互相独立；忘记密码可以用邮箱找回；可以自己注销账户。

---

## 第 1 步：把项目地址和公开密钥填进 App（2 分钟）

1. 打开 Supabase 后台 → 左侧 **Project Settings → Data API**，复制 **Project URL**（形如 `https://xxxx.supabase.co`）
2. **Project Settings → API Keys**，复制 **Publishable key**（`sb_publishable_` 开头）
   - 也可以用 Legacy API Keys 里的 **anon** key
   - ⚠️ **绝对不要**用 secret / service_role key
3. 用「文本编辑」或 VS Code 打开文件夹里的 `js/config.js`，填进引号里：

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_xxxxxxxx';
```

保存。之后设置页就不会再显示这两个输入框，只需要邮箱和密码。

---

## 第 2 步：运行更新脚本，开启「注销账户」（1 分钟）

Supabase 后台 → 左侧 **SQL Editor** → New query → 把 `supabase/delete-account.sql` 的全部内容粘贴进去 → **Run**，看到 Success 即可。

---

## 第 3 步：设置回跳网址（1 分钟）

让重置密码邮件里的链接能回到日拾。

Supabase 后台 → **Authentication → URL Configuration**：

- **Site URL**：填你的 Netlify 网址，例如 `https://你的名字.netlify.app`
- **Redirect URLs** → Add URL：填 `https://你的名字.netlify.app/**`

保存。

---

## 第 4 步：用 QQ 邮箱发信（10 分钟，免费）

Supabase 自带的发信服务只能发给你自己（每小时 2 封），朋友收不到重置密码邮件，所以要换成你自己的邮箱发信。

### 4.1 在 QQ 邮箱拿「授权码」

1. 电脑浏览器登录 mail.qq.com
2. 右上角 **设置 → 账号与安全**（旧版是「设置 → 账户」）
3. 找到 **POP3/IMAP/SMTP/Exchange/CardDAV 服务**，开启 **SMTP 服务**
4. 按提示用手机发短信验证，得到一串 16 位的 **授权码**，复制保存好（它就是 SMTP 密码，不是你的 QQ 密码）

> 用 163 邮箱也可以：服务器 `smtp.163.com`，端口 `465`，同样用授权码。

### 4.2 在 Supabase 填写

Supabase 后台 → **Authentication → Emails → SMTP Settings**（有的版本在 Authentication → Notifications → Emails 里）→ 打开 **Enable Custom SMTP**：

| 项目 | 填写 |
|---|---|
| Sender email | 你的 QQ 邮箱，如 `12345678@qq.com` |
| Sender name | `日拾` |
| Host | `smtp.qq.com` |
| Port | `465` |
| Minimum interval | 保持默认 60 秒 |
| Username | 你的 QQ 邮箱完整地址 |
| Password | 上一步拿到的授权码 |

保存。

### 4.3（可选）把邮件改成中文

**Authentication → Emails → Templates → Reset Password**：

- Subject：`日拾 · 重置密码`
- Message body：

```html
<h2>重置你的日拾密码 🌷</h2>
<p>点击下面的链接，回到日拾设置新密码：</p>
<p><a href="{{ .ConfirmationURL }}">设置新密码</a></p>
<p>如果不是你本人操作，忽略这封邮件就好。</p>
```

### 4.4 测试一下

在 App 设置页点「忘记密码？」，输入你自己的邮箱，看能不能收到邮件（第一次可能在垃圾箱里），点链接后能不能设置新密码。

---

## 第 5 步：更新网站

把整个 `日拾` 文件夹拖到 Netlify 项目的 **Deploys** 页面。

---

## 第 6 步：邀请朋友（不超过 3 个人）

1. 把网址发给朋友，请他们用 Safari 打开 →「分享 → 添加到主屏幕」（打开「作为网页 App 打开」）
2. 从主屏幕打开 → 右上角齿轮 → 填邮箱和密码 →「注册新账号」
3. 他们自己的 iPad、Mac 用同一个账号「登录」就会同步
4. 提醒他们在设置里点「开启通知」

## 第 7 步：朋友都注册好后，关闭注册入口

Supabase 后台 → **Authentication → Sign In / Providers** → 最上面 **User Signups** → 关掉 **Allow new users to sign up** → 保存。

这样网址被别人看到也无法注册。以后要加人，临时打开、注册完再关掉。

---

## 要提前告诉朋友的事

- 每个人的数据互相看不到，但**你是项目管理员**，在 Supabase 后台的数据表里技术上能看到所有人的原始数据（包括复盘内容）
- 数据没有加密到"连管理员都看不到"的程度，请不要在里面记密码、证件号这类敏感信息
- 不想用了可以在设置里「注销账户」，云端数据会全部删除

## 常见问题

- **收不到重置邮件**：看看垃圾箱；检查第 4 步的授权码和端口；Supabase 后台 **Logs → Auth** 里能看到发送失败的原因
- **点邮件链接提示"链接已过期"**：链接只能用一次、有有效期，重新点「忘记密码」
- **注册时提示「暂不开放注册」**：第 7 步关掉了注册，临时打开即可
- **注销时提示「云端还没有注销功能」**：第 2 步的脚本还没运行
