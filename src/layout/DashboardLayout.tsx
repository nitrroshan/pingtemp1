import React from 'react';
import { Box, Grid, Paper } from '@mui/material';
import ChartComponent from '../components/ChartComponent';
import useRealTimeData from '../hooks/useRealTimeData';

const DashboardLayout: React.FC = () => {
    const { data: chart1Data, error: chart1Error } = useRealTimeData('wss://example.com/chart1');
    const { data: chart2Data, error: chart2Error } = useRealTimeData('wss://example.com/chart2');

    return (
        <Box sx={{ flexGrow: 1 }}>
            {/* Navigation Bar */}
            <Paper elevation={3} sx={{ padding: 2, marginBottom: 2 }}>
                <Grid container>
                    <Grid item xs={12}>Navigation Bar Placeholder</Grid>
                </Grid>
            </Paper>

            {/* Filters Section */}
            <Paper elevation={3} sx={{ padding: 2, marginBottom: 2 }}>
                <Grid container>
                    <Grid item xs={12}>Filters Placeholder</Grid>
                </Grid>
            </Paper>

            {/* Charts Section */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                    <Paper elevation={3} sx={{ padding: 2 }}>
                        {chart1Error ? (
                            <div>Error: {chart1Error}</div>
                        ) : (
                            <ChartComponent data={chart1Data} />
                        )}
                    </Paper>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Paper elevation={3} sx={{ padding: 2 }}>
                        {chart2Error ? (
                            <div>Error: {chart2Error}</div>
                        ) : (
                            <ChartComponent data={chart2Data} />
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DashboardLayout;