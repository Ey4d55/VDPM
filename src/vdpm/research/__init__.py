"""Research experiments that produce the platform's reportable results.

Each experiment is a pure function returning plain data, plus a writer that
saves CSV tables and figures. :func:`vdpm.research.run.run_all` executes the
full, seeded suite and writes everything to one output directory, so every
number reported in the manuscript can be regenerated with one command::

    vdpm research --out results

Requires the optional ``research`` dependencies (NumPy and Matplotlib).
"""
