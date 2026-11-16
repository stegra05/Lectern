#!/usr/bin/env python3
"""Check a judged run's verdict files before `bench.ts report`.

    python3 .claude/skills/exam-bench/check-verdicts.py <run folder>

A judge mistypes a card id about once in a deck, and `report` then refuses the file. This
names every verdict whose card the run lacks and every pair of a batch without a verdict. Where
exactly one unjudged pair of the same point has a close id, it corrects the id in place and
says so. Anything else it leaves for a person: look at the pair and decide.
"""
import difflib
import glob
import json
import os
import sys

run = sys.argv[1]
cards = {card["id"] for card in json.load(open(os.path.join(run, "cards.json")))}
clean = True
for path in sorted(glob.glob(os.path.join(run, "verdicts", "*.json"))):
    name = os.path.basename(path)
    batch_path = os.path.join(run, "pairs", name)
    if not os.path.exists(batch_path):
        continue  # labels carried over from an earlier round, not a batch of this one
    labels = json.load(open(path))
    want = {(entry["point"], card["id"]) for entry in json.load(open(batch_path)) for card in entry["cards"]}
    missing = want - {(label["point"], label["card"]) for label in labels}
    changed = False
    for label in labels:
        if label["card"] in cards:
            continue
        options = [card for point, card in missing if point == label["point"]]
        close = difflib.get_close_matches(label["card"], options, n=2, cutoff=0.8)
        if len(close) == 1:
            print(f"{name}: corrected {label['card']} to {close[0]} ({label['verdict']})")
            label["card"] = close[0]
            changed = True
        else:
            clean = False
            print(f"{name}: UNRESOLVED {label['point']} names {label['card']} ({label['verdict']}); unjudged cards of that point: {options}")
    if changed:
        json.dump(labels, open(path, "w"))
    left = want - {(label["point"], label["card"]) for label in labels}
    for point, card in sorted(left):
        clean = False
        print(f"{name}: NO VERDICT for {point} with {card}")
    odd = [label for label in labels if (label["point"], label["card"]) not in want and label["verdict"] != "same"]
    for label in odd:
        clean = False
        print(f"{name}: a pair outside the batch is labelled {label['verdict']}: {label['point']} with {label['card']} (often a slipped id)")
print("All verdict files are complete." if clean else "Fix the lines above by hand, then run this again.")
sys.exit(0 if clean else 1)
