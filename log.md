---

1. DROPLET_SSH_KEY (SSH Private Key)  
   Where Your local machine where you generated the SSH key.

# On your local machine (Git Bash / terminal)
```bash
cat ~/.ssh/id_ed25519

Copy the entire output including -----BEGIN OPENSSH PRIVATE KEY----- and -----END OPENSSH PRIVATE KEY-----.
This is the private key (not .pub).

If you haven't generated one yet:
ssh-keygen -t ed25519 -C "your-email@example.com"
Then add the public key (.pub) to your droplet during creation or via ssh-copy-id root@YOUR_DROPLET_IP.
```
---

1. DROPLET_HOST

Where: DigitalOcean Console → Droplets → your droplet's IP address (e.g., 164.90.xxx.xxx)

Just the IP, nothing else.

---

1. DROPLET_USER

Value: root (default) or deploy if you created a non-root user on the droplet.

---

1. VSCE_PAT (VS Code Marketplace Token)

Where: Azure DevOps

1. Go to <https://dev.azure.com>
2. Sign in with a Microsoft account (same one you'll use for the marketplace publisher)
3. Click your profile icon (top right) → Personal Access Tokens
4. Click New Token
5. Settings:

   - Organization: All accessible organizations (required for vsce)
   - Expiration: 1 year (max)
   - Scopes: Custom defined → Marketplace → check Manage

6. Click Create → copy the token immediately (shown only once)

Prerequisite: You also need to create the publisher ptah-extensions at
<https://marketplace.visualstudio.com/manage> before you can publish.
