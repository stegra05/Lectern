# Lectern docs

Three kinds of document, each with one job.

| Kind              | Answers                        | Where                                                        |
| ----------------- | ------------------------------ | ------------------------------------------------------------ |
| **RFDs**          | why it is this way             | [`rfd/`](rfd/), one decision each                            |
| **Reference**     | how it works today             | [`architecture.md`](architecture.md), [`design/KIT.md`](../design/KIT.md), [`design/cards/FIELDS.md`](../design/cards/FIELDS.md) |
| **Status**        | what is true and unverified now | [`status.md`](status.md)                                    |

What comes next is never in a doc. It is an issue on the
[roadmap board](https://github.com/users/stegra05/projects/3).

## The RFDs

Start with 1. The rest can be read in any order.

| RFD                                              | In one breath                                                                  | State                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------- |
| [1](rfd/0001-the-product.md)                     | State a goal once, get a deck you can trust                                    | decided               |
| [2](rfd/0002-code-decides.md)                    | Code decides, the cheap model fills slots                                      | decided               |
| [3](rfd/0003-engine-boundary-folder.md)          | One headless engine, one boundary, a course is a folder of plain files        | decided               |
| [4](rfd/0004-lecture-to-cards.md)                | Read every slide, keep the facts worth most, gate every card                   | decided, revised      |
| [5](rfd/0005-decision-models.md)                 | Decision models judge, only measured checks act                                | decided               |
| [6](rfd/0006-money.md)                           | Every run says its price first, and stops at three times that                 | decided               |
| [7](rfd/0007-presets.md)                         | One concept preset for every course, kinds later                               | decided               |
| [8](rfd/0008-past-exams.md)                      | Past exams become cards, not weights                                           | decided               |
| [9](rfd/0009-cards-in-anki.md)                   | Two note types, sent once, never rewritten                                     | decided               |
| [10](rfd/0010-card-designs.md)                   | Native, the one card design of v3.0, five more later                           | decided               |
| [11](rfd/0011-app-shape.md)                      | A native window, a snake of lectures, rings, one side panel                    | decided, needs polish |
| [12](rfd/0012-feedback-loop.md)                  | Feedback through fixed actions, no free text                                   | decided, not built    |
| [13](rfd/0013-copy-for-chat.md)                  | One button copies the course for a chat tutor                                  | deferred, #195        |
| [14](rfd/0014-the-quality-bar.md)                | The bar is the marks of unseen past papers, then Steffen's own deck            | measuring             |

## Writing an RFD

An RFD records one decision Steffen made, with the evidence behind it. It is written when the
decision is made, in the same pull request as the code it shapes, and changed when the
decision changes. History lives in git, not in the file.

States: **discussion** (proposed, not yet his call), **decided**, **superseded by N** (kept
one release, then deleted). Add "built" or "not built" when it helps.

```markdown
# RFD N · A title that states the decision

|           |                          |
| --------- | ------------------------ |
| **State** | decided                  |
| **Date**  | YYYY-MM-DD               |
| **Code**  | where it lives           |

> **In one breath.** The decision in one or two sentences a newcomer understands.

## Decision
## Why            measured figures beat opinions
## Given up       what lost, and in one line why
## Open           links to issues only, never a to-do list
```

Plain words, no em-dashes, figures with their date. Something still to do is an issue,
linked from **Open**.
