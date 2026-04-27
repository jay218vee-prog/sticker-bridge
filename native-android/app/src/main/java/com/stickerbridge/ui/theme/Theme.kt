package com.stickerbridge.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme

@Composable
fun StickerBridgeTheme(content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val dynamic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val scheme = when {
        dynamic && isSystemInDarkTheme() -> dynamicDarkColorScheme(ctx)
        dynamic -> dynamicLightColorScheme(ctx)
        else -> lightColorScheme()
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
