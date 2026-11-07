---
title: Switching models
description: Change the model during a conversation.
sidebar:
  order: 8
---

# Switching models

The model selector in the composer changes the model of the session. The next message uses the new model. The transcript stays.

![Model selector in the chat header](/screenshots/chat-model-selector.png)

## What to expect when you switch

- The prompt cache is specific to a provider. A new provider starts with no cache.
- A model without thinking support does not get the thinking blocks.
- A move from a reasoning model to a model without reasoning can lower the quality of the answer. Finish the current subtask first when possible.

## Defaults

PtahCode stores the default provider in `~/.ptah/settings.json` (`llm.defaultProvider`). To change the default, use the Providers settings page. Refer to [Providers](/providers/).
