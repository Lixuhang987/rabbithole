# Rabbithole

Rabbithole organizes documents and questions into a branching reading canvas.

## Language

**Article node**:
A document on the reading canvas, used as the source of a selection Ask or a
whole-article follow-up, or produced as the answer to an Ask.

**Node conversation**:
The backend conversation associated with an article node. An Ask on that article
branches from this conversation, and its answer owns the resulting conversation.
These conversations are used exclusively by Rabbithole.
_Avoid_: Current thread, latest thread
