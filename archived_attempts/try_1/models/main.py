"""
CF2L Fast Diagnostic v3 - Extremely fast debug mode
Target: < 90 sec/epoch on 2015 MBP CPU
"""

import numpy as np
import tensorflow as tf
from tensorflow import keras
from keras import layers
from keras.utils import to_categorical

# ==================== CONFIG - MAX SPEED ====================
SUBSAMPLE_FRAC = 0.04  # ~130k examples — tune between 0.03–0.08
BATCH_SIZE = 256  # Smaller often faster on old CPU
EPOCHS = 6
MODEL_NAME = "cf2l_fastdiag_v3"

TRAIN_FILE = "data/npz/training/cn_RL_train.npz"
VAL_FILE = "data/npz/validation/cn_RL_val.npz"

# ==================== Load & subsample ====================
print("Loading & heavy subsampling...")
data = np.load(TRAIN_FILE)
n = len(data["states"])
idx = np.random.choice(n, size=int(n * SUBSAMPLE_FRAC), replace=False)
X_train_raw = data["states"][idx].astype(np.uint8)
y_train_raw = data["labels"][idx].astype(np.uint8)

val_data = np.load(VAL_FILE)
X_val_raw = val_data["states"].astype(np.uint8)[:150000]  # cap val too
y_val_raw = val_data["labels"].astype(np.uint8)[:150000]

print(f"Train: {len(X_train_raw):,} | Val: {len(X_val_raw):,}")

# Preprocessing
X_train = to_categorical(X_train_raw, 6)
X_val = to_categorical(X_val_raw, 6)
y_train_cat = to_categorical(y_train_raw, 54)
y_val_cat = to_categorical(y_val_raw, 54)

# Quick top-10
print("\nTop 10 moves (train):")
unique, counts = np.unique(y_train_raw, return_counts=True)
for i in np.argsort(-counts)[:10]:
    print(
        f"  move {unique[i]:2d}: {counts[i]:6,d} ({counts[i]/len(y_train_raw)*100:5.2f}%)"
    )


# ==================== Tiny model ====================
def res_block(x, filters):
    shortcut = x
    x = layers.Conv1D(filters, 3, padding="same", activation="relu")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Conv1D(filters, 3, padding="same")(x)
    x = layers.BatchNormalization()(x)
    if shortcut.shape[-1] != filters:
        shortcut = layers.Conv1D(filters, 1, padding="same")(shortcut)
    x = layers.Add()([shortcut, x])
    return layers.Activation("relu")(x)


inputs = keras.Input(shape=(54, 6))
x = layers.Conv1D(64, 3, padding="same", activation="relu")(inputs)
x = layers.BatchNormalization()(x)

x = res_block(x, 96)
x = res_block(x, 128)  # only 2 blocks
x = layers.MaxPooling1D(2)(x)
x = layers.GlobalAveragePooling1D()(x)

x = layers.Dense(192, activation="relu")(x)
x = layers.Dropout(0.3)(x)
outputs = layers.Dense(54, activation="softmax")(x)

model = keras.Model(inputs, outputs)
model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=0.0015, clipnorm=1.0),
    loss="categorical_crossentropy",
    metrics=[
        "accuracy",
        keras.metrics.TopKCategoricalAccuracy(k=5, name="top_5"),
        keras.metrics.TopKCategoricalAccuracy(k=10, name="top_10"),
    ],
)

model.summary()

# ==================== Train fast ====================
callbacks = [
    keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss", factor=0.6, patience=3, min_lr=1e-5, verbose=1
    )
]

print("\nTraining (should be fast now)...")
history = model.fit(
    X_train,
    y_train_cat,
    validation_data=(X_val, y_val_cat),
    epochs=EPOCHS,
    batch_size=BATCH_SIZE,
    callbacks=callbacks,
    verbose=2,
)

# Quick final report
print("\n" + "=" * 50)
metrics = model.evaluate(X_val, y_val_cat, batch_size=BATCH_SIZE, verbose=0)
print(
    f"val_loss: {metrics[0]:.4f} | top-1: {metrics[1]:.4f} | top_5: {metrics[2]:.4f} | top_10: {metrics[3]:.4f}"
)
