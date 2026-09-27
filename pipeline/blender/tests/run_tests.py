"""Discover and run pipeline/blender/tests/test_*.py inside Blender; non-zero exit on failure."""
import os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "lib"), os.path.join(ROOT, "toothless"), HERE]
suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise RuntimeError("pipeline tests failed")
